import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type {
  ActionRun,
  Area,
  Brief,
  CalendarEvent,
  Item,
  ItemKind,
  ItemStatus,
  McpServer,
  Note,
  RunLogEntry,
  Source,
  SourceType
} from '@shared/types'
import { addDays, defaultDueDate, toDay } from '@shared/dates'
import { decrypt, encrypt } from './secrets'

let db: Database.Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content_json TEXT NOT NULL DEFAULT '',
  plain TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, extracted_at TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(note_id UNINDEXED, title, plain, tokenize='unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS areas (id TEXT PRIMARY KEY, name TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, person TEXT, due_date TEXT,
  prep_days INTEGER NOT NULL DEFAULT 0, area_id TEXT, status TEXT NOT NULL,
  source_type TEXT NOT NULL, source_ref TEXT, source_snippet TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, done_at TEXT
);
CREATE INDEX IF NOT EXISTS items_status ON items(status);
CREATE TABLE IF NOT EXISTS workflow_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, markdown TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, config_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, last_sync TEXT, last_error TEXT
);
CREATE TABLE IF NOT EXISTS mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, config_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, title TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0, location TEXT, attendees_json TEXT NOT NULL DEFAULT '[]', description TEXT
);
CREATE INDEX IF NOT EXISTS events_start ON events(start);
CREATE TABLE IF NOT EXISTS briefs (date TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS action_runs (
  id TEXT PRIMARY KEY, item_id TEXT, goal TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
  log_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

export function openDb(file: string): void {
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  // Notas dentro de notas: columna añadida después; se crea si falta.
  const noteCols = db.prepare('PRAGMA table_info(notes)').all() as { name: string }[]
  if (!noteCols.some((c) => c.name === 'parent_id')) db.exec('ALTER TABLE notes ADD COLUMN parent_id TEXT')
  // Nombre de la herramienta de donde sale una tarea (Slack, Gmail…): añadido después.
  const itemCols = db.prepare('PRAGMA table_info(items)').all() as { name: string }[]
  if (!itemCols.some((c) => c.name === 'source_tool')) db.exec('ALTER TABLE items ADD COLUMN source_tool TEXT')
  if (!itemCols.some((c) => c.name === 'context')) db.exec('ALTER TABLE items ADD COLUMN context TEXT')
  if (!itemCols.some((c) => c.name === 'dismiss_reason')) db.exec('ALTER TABLE items ADD COLUMN dismiss_reason TEXT')
  // Una sola vez: lo pendiente que no tenía fecha pasa a tenerla mañana.
  if (!getSetting('migr.undatedTomorrow')) {
    db.prepare(
      "UPDATE items SET due_date = ?, updated_at = ? WHERE due_date IS NULL AND kind != 'decision' AND status IN ('proposed', 'active')"
    ).run(addDays(toDay(new Date()), 1), now())
    setSetting('migr.undatedTomorrow', '1')
  }
}

const now = () => new Date().toISOString()

// ---------- settings ----------
export function getSetting(key: string): string | null {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return r?.value ?? null
}
export function setSetting(key: string, value: string | null): void {
  if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  else db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

// ---------- notes ----------
type NoteRow = { id: string; parent_id: string | null; title: string; content_json: string; plain: string; created_at: string; updated_at: string }
const toNote = (r: NoteRow): Note => ({
  parentId: r.parent_id ?? null,
  id: r.id, title: r.title, contentJson: r.content_json, plain: r.plain, createdAt: r.created_at, updatedAt: r.updated_at
})

export function listNotes(): Note[] {
  return (db.prepare('SELECT * FROM notes ORDER BY updated_at DESC').all() as NoteRow[]).map(toNote)
}
export function getNote(id: string): Note | null {
  const r = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined
  return r ? toNote(r) : null
}
export function createNote(title = '', parentId: string | null = null): Note {
  const id = randomUUID()
  const t = now()
  const parent = parentId && getNote(parentId) ? parentId : null
  db.prepare('INSERT INTO notes(id, parent_id, title, content_json, plain, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)').run(id, parent, title, '', '', t, t)
  db.prepare('INSERT INTO notes_fts(note_id, title, plain) VALUES(?, ?, ?)').run(id, title, '')
  return getNote(id)!
}
export function saveNote(id: string, title: string, contentJson: string, plain: string): Note {
  db.prepare('UPDATE notes SET title = ?, content_json = ?, plain = ?, updated_at = ? WHERE id = ?').run(title, contentJson, plain, now(), id)
  db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(id)
  db.prepare('INSERT INTO notes_fts(note_id, title, plain) VALUES(?, ?, ?)').run(id, title, plain)
  return getNote(id)!
}
/** Ids de todas las notas que cuelgan de esta (hijas, nietas…), sin incluirla. */
export function noteDescendants(id: string): string[] {
  const rows = db
    .prepare(
      `WITH RECURSIVE sub(id) AS (SELECT id FROM notes WHERE parent_id = ? UNION SELECT n.id FROM notes n JOIN sub ON n.parent_id = sub.id)
       SELECT id FROM sub`
    )
    .all(id) as { id: string }[]
  return rows.map((r) => r.id)
}
/** Borra la nota y todas las que tiene dentro. */
export function deleteNote(id: string): void {
  const ids = [id, ...noteDescendants(id)]
  const del = db.transaction(() => {
    for (const n of ids) {
      db.prepare('DELETE FROM notes WHERE id = ?').run(n)
      db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(n)
    }
  })
  del()
}
/** Mete la nota dentro de otra (o la saca al nivel principal con null). No deja meter una nota dentro de sí misma ni de sus hijas. */
export function moveNote(id: string, parentId: string | null): boolean {
  if (parentId === id) return false
  if (parentId && (!getNote(parentId) || noteDescendants(id).includes(parentId))) return false
  db.prepare('UPDATE notes SET parent_id = ? WHERE id = ?').run(parentId, id)
  return true
}
export function markNoteExtracted(id: string): void {
  db.prepare('UPDATE notes SET extracted_at = ? WHERE id = ?').run(now(), id)
}
export function noteNeedsExtraction(id: string): boolean {
  const r = db.prepare('SELECT updated_at, extracted_at FROM notes WHERE id = ?').get(id) as
    | { updated_at: string; extracted_at: string | null }
    | undefined
  return !!r && (!r.extracted_at || r.extracted_at < r.updated_at)
}
export function searchNotes(q: string, limit = 8): { id: string; title: string; snippet: string }[] {
  const terms = q
    .split(/\s+/)
    .map((w) => w.replace(/["*^():]/g, ''))
    .filter((w) => w.length > 1)
  if (!terms.length) return []
  const match = terms.map((w) => `"${w}"*`).join(' OR ')
  return db
    .prepare(
      `SELECT note_id AS id, title, snippet(notes_fts, 2, '«', '»', '…', 24) AS snippet
       FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?`
    )
    .all(match, limit) as { id: string; title: string; snippet: string }[]
}

// ---------- areas ----------
export function listAreas(): Area[] {
  return db.prepare('SELECT id, name, weight FROM areas ORDER BY weight DESC, name').all() as Area[]
}
export function upsertArea(a: Partial<Area> & { name: string }): Area {
  const id = a.id ?? randomUUID()
  db.prepare('INSERT INTO areas(id, name, weight) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, weight = excluded.weight').run(
    id, a.name, a.weight ?? 1
  )
  return { id, name: a.name, weight: a.weight ?? 1 }
}
export function deleteArea(id: string): void {
  db.prepare('UPDATE items SET area_id = NULL WHERE area_id = ?').run(id)
  db.prepare('DELETE FROM areas WHERE id = ?').run(id)
}
export function findAreaByName(name: string | null | undefined): Area | null {
  if (!name) return null
  const r = db.prepare('SELECT id, name, weight FROM areas WHERE lower(name) = lower(?)').get(name.trim()) as Area | undefined
  return r ?? null
}

// ---------- items ----------
type ItemRow = {
  id: string; kind: ItemKind; title: string; person: string | null; due_date: string | null; prep_days: number
  area_id: string | null; status: ItemStatus; source_type: SourceType; source_ref: string | null
  source_snippet: string | null; source_tool: string | null; context: string | null; dismiss_reason: string | null; created_at: string; updated_at: string; done_at: string | null
}
const toItem = (r: ItemRow): Item => ({
  id: r.id, kind: r.kind, title: r.title, person: r.person, dueDate: r.due_date, prepDays: r.prep_days,
  areaId: r.area_id, status: r.status, sourceType: r.source_type, sourceRef: r.source_ref,
  sourceSnippet: r.source_snippet, sourceTool: r.source_tool ?? null,
  context: r.context ?? null, dismissReason: r.dismiss_reason ?? null, createdAt: r.created_at, updatedAt: r.updated_at, doneAt: r.done_at
})

export function listItems(filter: { status?: ItemStatus[]; kind?: ItemKind[] } = {}): Item[] {
  const where: string[] = []
  const args: string[] = []
  if (filter.status?.length) {
    where.push(`status IN (${filter.status.map(() => '?').join(',')})`)
    args.push(...filter.status)
  }
  if (filter.kind?.length) {
    where.push(`kind IN (${filter.kind.map(() => '?').join(',')})`)
    args.push(...filter.kind)
  }
  const sql = `SELECT * FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, created_at DESC`
  return (db.prepare(sql).all(...args) as ItemRow[]).map(toItem)
}
export function getItem(id: string): Item | null {
  const r = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined
  return r ? toItem(r) : null
}
export type NewItem = Pick<Item, 'kind' | 'title'> & Partial<Omit<Item, 'id' | 'createdAt' | 'updatedAt'>>
export function createItem(p: NewItem): Item {
  const id = randomUUID()
  const t = now()
  db.prepare(
    `INSERT INTO items(id, kind, title, person, due_date, prep_days, area_id, status, source_type, source_ref, source_snippet, source_tool, context, created_at, updated_at, done_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, p.kind, p.title.trim(), p.person ?? null, defaultDueDate(p.kind, p.dueDate, toDay(new Date())), p.prepDays ?? 0, p.areaId ?? null,
    p.status ?? 'active', p.sourceType ?? 'manual', p.sourceRef ?? null, p.sourceSnippet ?? null, p.sourceTool ?? null,
    p.context?.trim() || null, t, t, null
  )
  return getItem(id)!
}
export function updateItem(id: string, patch: Partial<Omit<Item, 'id' | 'createdAt'>>): Item | null {
  const cur = getItem(id)
  if (!cur) return null
  const next = { ...cur, ...patch, updatedAt: now() }
  if (patch.status === 'done' && cur.status !== 'done') next.doneAt = now()
  if (patch.status && patch.status !== 'done') next.doneAt = null
  // El motivo de descarte solo tiene sentido mientras siga descartado.
  if (patch.status && patch.status !== 'dismissed') next.dismissReason = null
  db.prepare(
    `UPDATE items SET kind=?, title=?, person=?, due_date=?, prep_days=?, area_id=?, status=?, source_type=?, source_ref=?, source_snippet=?, context=?, dismiss_reason=?, updated_at=?, done_at=? WHERE id=?`
  ).run(
    next.kind, next.title, next.person, next.dueDate, next.prepDays, next.areaId, next.status, next.sourceType,
    next.sourceRef, next.sourceSnippet, next.context?.trim() || null, next.dismissReason?.trim() || null, next.updatedAt, next.doneAt, id
  )
  return getItem(id)
}
export function deleteItem(id: string): void {
  db.prepare('DELETE FROM items WHERE id = ?').run(id)
}
/** Evita duplicar propuestas cuando se vuelve a analizar la misma nota. */
export function countProposed(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM items WHERE status = 'proposed'").get() as { n: number }).n
}

// ---------- workflow ----------
export function getWorkflow(): { markdown: string; version: number; updatedAt: string | null } {
  const r = db.prepare('SELECT id, markdown, created_at FROM workflow_versions ORDER BY id DESC LIMIT 1').get() as
    | { id: number; markdown: string; created_at: string }
    | undefined
  return r ? { markdown: r.markdown, version: r.id, updatedAt: r.created_at } : { markdown: '', version: 0, updatedAt: null }
}
export function saveWorkflow(markdown: string): { version: number } {
  if (getWorkflow().markdown === markdown) return { version: getWorkflow().version }
  const r = db.prepare('INSERT INTO workflow_versions(markdown, created_at) VALUES(?, ?)').run(markdown, now())
  return { version: Number(r.lastInsertRowid) }
}
export function listWorkflowVersions(): { version: number; createdAt: string; preview: string }[] {
  return (db.prepare('SELECT id, created_at, substr(markdown, 1, 120) AS p FROM workflow_versions ORDER BY id DESC LIMIT 50').all() as {
    id: number; created_at: string; p: string
  }[]).map((r) => ({ version: r.id, createdAt: r.created_at, preview: r.p }))
}
export function getWorkflowVersion(version: number): string | null {
  const r = db.prepare('SELECT markdown FROM workflow_versions WHERE id = ?').get(version) as { markdown: string } | undefined
  return r?.markdown ?? null
}

// ---------- sources ----------
type SourceRow = { id: string; kind: 'ics' | 'mcp'; name: string; config_json: string; enabled: number; last_sync: string | null; last_error: string | null }
const toSource = (r: SourceRow): Source => ({
  id: r.id, kind: r.kind, name: r.name, config: JSON.parse(r.config_json), enabled: !!r.enabled, lastSync: r.last_sync, lastError: r.last_error
})
export function listSources(): Source[] {
  return (db.prepare('SELECT * FROM sources ORDER BY name').all() as SourceRow[]).map(toSource)
}
export function upsertSource(s: Omit<Source, 'id' | 'lastSync' | 'lastError'> & { id?: string }): Source {
  const id = s.id ?? randomUUID()
  db.prepare(
    `INSERT INTO sources(id, kind, name, config_json, enabled) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name, config_json = excluded.config_json, enabled = excluded.enabled`
  ).run(id, s.kind, s.name, JSON.stringify(s.config), s.enabled ? 1 : 0)
  return listSources().find((x) => x.id === id)!
}
export function markSourceSynced(id: string, error: string | null): void {
  db.prepare('UPDATE sources SET last_sync = ?, last_error = ? WHERE id = ?').run(now(), error, id)
}
export function deleteSource(id: string): void {
  db.prepare('DELETE FROM sources WHERE id = ?').run(id)
  db.prepare('DELETE FROM events WHERE source_id = ?').run(id)
}

// ---------- MCP servers ----------
type McpRow = { id: string; name: string; config_json: string; enabled: number }
export function listMcpServers(): McpServer[] {
  return (db.prepare('SELECT * FROM mcp_servers ORDER BY name').all() as McpRow[]).map((r) => ({
    id: r.id, name: r.name, config: JSON.parse(decrypt(r.config_json)), enabled: !!r.enabled
  }))
}
export function upsertMcpServer(s: Omit<McpServer, 'id'> & { id?: string }): McpServer {
  const id = s.id ?? randomUUID()
  db.prepare(
    `INSERT INTO mcp_servers(id, name, config_json, enabled) VALUES(?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, config_json = excluded.config_json, enabled = excluded.enabled`
  ).run(id, s.name, encrypt(JSON.stringify(s.config)), s.enabled ? 1 : 0)
  return listMcpServers().find((x) => x.id === id)!
}
export function deleteMcpServer(id: string): void {
  db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
}

// ---------- events ----------
type EventRow = { id: string; source_id: string; title: string; start: string; end: string; all_day: number; location: string | null; attendees_json: string; description: string | null }
const toEvent = (r: EventRow): CalendarEvent => ({
  id: r.id, sourceId: r.source_id, title: r.title, start: r.start, end: r.end, allDay: !!r.all_day,
  location: r.location, attendees: JSON.parse(r.attendees_json), description: r.description
})
export function replaceEvents(sourceId: string, events: CalendarEvent[]): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM events WHERE source_id = ?').run(sourceId)
    const ins = db.prepare(
      'INSERT OR REPLACE INTO events(id, source_id, title, start, end, all_day, location, attendees_json, description) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const e of events) ins.run(e.id, sourceId, e.title, e.start, e.end, e.allDay ? 1 : 0, e.location, JSON.stringify(e.attendees), e.description)
  })
  tx()
}
export function listEvents(fromIso: string, toIso: string): CalendarEvent[] {
  return (db.prepare('SELECT * FROM events WHERE start < ? AND end > ? ORDER BY start').all(toIso, fromIso) as EventRow[]).map(toEvent)
}

// ---------- briefs ----------
export function getBrief(date: string): Brief | null {
  const r = db.prepare('SELECT json FROM briefs WHERE date = ?').get(date) as { json: string } | undefined
  return r ? (JSON.parse(r.json) as Brief) : null
}
export function saveBrief(b: Brief): void {
  db.prepare('INSERT INTO briefs(date, json, created_at) VALUES(?, ?, ?) ON CONFLICT(date) DO UPDATE SET json = excluded.json, created_at = excluded.created_at').run(
    b.date, JSON.stringify(b), now()
  )
}

// ---------- action runs ----------
type RunRow = { id: string; item_id: string | null; goal: string; mode: 'normal' | 'drafts'; status: ActionRun['status']; log_json: string; created_at: string }
const toRun = (r: RunRow): ActionRun => ({
  id: r.id, itemId: r.item_id, goal: r.goal, mode: r.mode, status: r.status, log: JSON.parse(r.log_json), createdAt: r.created_at
})
export function createRun(itemId: string | null, goal: string, mode: 'normal' | 'drafts'): ActionRun {
  const id = randomUUID()
  db.prepare('INSERT INTO action_runs(id, item_id, goal, mode, status, log_json, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)').run(
    id, itemId, goal, mode, 'running', '[]', now()
  )
  return getRun(id)!
}
export function getRun(id: string): ActionRun | null {
  const r = db.prepare('SELECT * FROM action_runs WHERE id = ?').get(id) as RunRow | undefined
  return r ? toRun(r) : null
}
export function appendRunLog(id: string, entry: RunLogEntry): void {
  const run = getRun(id)
  if (!run) return
  run.log.push(entry)
  db.prepare('UPDATE action_runs SET log_json = ? WHERE id = ?').run(JSON.stringify(run.log), id)
}
export function setRunStatus(id: string, status: ActionRun['status']): void {
  db.prepare('UPDATE action_runs SET status = ? WHERE id = ?').run(status, id)
}
export function listRuns(limit = 30): ActionRun[] {
  return (db.prepare('SELECT * FROM action_runs ORDER BY created_at DESC LIMIT ?').all(limit) as RunRow[]).map(toRun)
}

export function isEmpty(): boolean {
  const n = (db.prepare('SELECT (SELECT COUNT(*) FROM notes) + (SELECT COUNT(*) FROM items) + (SELECT COUNT(*) FROM workflow_versions) AS n').get() as { n: number }).n
  return n === 0
}
