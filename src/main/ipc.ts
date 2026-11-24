import { dialog, ipcMain, shell, BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { addDays, toDay } from '@shared/dates'
import { rankItems, scoreItem } from '@shared/priority'
import { toggleCheck } from '@shared/plan'
import { buildHistory } from '@shared/history'
import type { CalendarEvent, MeetingInfo, TodayView } from '@shared/types'
import * as db from './db'
import { dataChanged } from './events'
import { getSettings, updateSettings } from './settings'
import { seedDemo, seedTemplateOnly } from './seed'
import { agentEnv, cachedAiStatus, friendlyError, markAiFailure, markAiOk, testAi } from './agent/client'
import { connectorLabel, listClaudeConnectors } from './agent/connectors'
import { parsePermissions } from '@shared/permissions'
import { dayRange, generateBrief } from './agent/brief'
import { extractToInbox } from './agent/extract'
import { chatClose, chatSend, chatStart, chatStop } from './agent/chat'
import { claudeUsage } from './agent/usage'
import { answerApproval } from './agent/permissions-gate'
import { appendToSection, suggestRules } from './agent/suggest-rules'
import { capture, connectorEventsSourceId, importFile, importTranscript, isCalendarConnector, syncConnectorCalendars, syncIcs, syncMcpSource } from './sources'
import { shortcutLabel } from './shortcut'
import { checkForUpdate, installNow, updateStatus } from './updater'
import { flowSignals, mergeFlow } from '@shared/flow'
import { MEETING_LABEL, meetingType, prepFromJira } from '@shared/meetings'
import { decideNews, lastNewsAt, newsRunning, pendingNews, reviewNews, type NewsDecision } from './novedades'
import { currentMeasures, planMeasurements, recordMeasure, setMeasureDate } from './measure'
import { addRoadNotes, listRoadNotes, markRoadNote } from './roadlog'
import { nextStepFor, stagePath } from '@shared/initiative'
import { sprintRowFor } from '@shared/sprint'
import { meetingNoteIds, noteForMeeting, reviewNote, type ReviewEntry } from './meetings'
import { forgetLesson, hiddenFlow, hideFlow, learn, lessonsSinceSuggest, listLessons, markSuggested } from './learning'
import { getSnapshot, guessJira, jiraConnector, jiraPrefs, jiraProjects, jiraSyncing, lastJiraError, saveJiraPrefs, syncJira } from './jira'

/** Llamadas que usan la IA: anotan el estado de la conexión. */
async function withAi<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const r = await fn()
    markAiOk()
    return r
  } catch (e) {
    markAiFailure(e)
    throw new Error(friendlyError(e))
  }
}

async function extractNote(id: string, force = false): Promise<number> {
  const note = db.getNote(id)
  if (!note || (!force && !db.noteNeedsExtraction(id))) return 0
  const n = await withAi(() =>
    extractToInbox({ text: `${note.title}\n\n${note.plain}`, sourceType: 'note', sourceRef: note.id, label: `nota «${note.title || 'sin título'}»` })
  )
  db.markNoteExtracted(id)
  dataChanged('items')
  return n
}

function todayView(): TodayView {
  const date = toDay(new Date())
  const areas = db.listAreas()
  // Agenda de los próximos 7 días, para el dashboard.
  const from = dayRange(date).from
  const to = dayRange(addDays(date, 6)).to
  const proposed = db.listItems({ status: ['proposed'] })
  const events = db.listEvents(from, to)
  const brief = db.getBrief(date)
  const active = db.listItems({ status: ['active'] })
  return {
    date,
    ranked: rankItems(active, date, areas),
    doneToday: db
      .listItems({ status: ['done'] })
      .filter((i) => i.doneAt && toDay(new Date(i.doneAt)) === date)
      .map((i) => scoreItem(i, date, areas)),
    events,
    brief,
    areas,
    proposedCount: proposed.length,
    proposed,
    flow: mergeFlow(flowSignals(getSnapshot(), events, new Date(), measuresForFlow()), brief?.flow, hiddenFlow(), date),
    encargos: active.filter((i) => i.kind === 'promise').length,
    weeklyAnswered: !!brief && db.getSetting('weekly.answered') === brief.generatedAt,
    meetings: meetingInfo(events),
    lessonsNew: lessonsSinceSuggest()
  }
}

export function measuresForFlow() {
  return currentMeasures().map((m) => ({ key: m.key, title: m.title, url: m.url, kpi: m.plan.kpi, due: m.due }))
}

function meetingInfo(events: CalendarEvent[]): Record<string, MeetingInfo> {
  const snap = getSnapshot()
  const notes = meetingNoteIds()
  const now = new Date()
  return Object.fromEntries(
    events
      .filter((e) => !e.allDay)
      .map((e) => {
        const type = meetingType(e.title)
        return [e.id, { type, label: MEETING_LABEL[type], jira: prepFromJira(type, snap, now), noteId: notes[e.id] ?? null }]
      })
  )
}

const api: Record<string, (...args: any[]) => unknown> = {
  // ajustes e IA
  'settings.get': () => ({ ...getSettings(), shortcut: shortcutLabel() }),
  'settings.update': (patch) => updateSettings(patch),
  'ai.status': () => cachedAiStatus(),
  'update.status': () => updateStatus(),
  'update.check': () => checkForUpdate(),
  'update.install': () => installNow(),
  'ai.test': () => testAi(),
  'ai.usage': (refresh?: boolean) => claudeUsage(!!refresh),
  'onboarding.finish': (opts: { demo: boolean }) => {
    if (db.isEmpty()) (opts.demo ? seedDemo : seedTemplateOnly)()
    updateSettings({ onboarded: true })
    dataChanged('all')
    return true
  },
  'demo.load': () => {
    seedDemo()
    dataChanged('all')
    return true
  },

  // jira
  'jira.get': async () => ({
    snapshot: getSnapshot(),
    connector: await jiraConnector(),
    syncing: jiraSyncing(),
    error: lastJiraError(),
    projects: jiraProjects(),
    prefs: jiraPrefs()
  }),
  'jira.savePrefs': (p) => {
    const resync = saveJiraPrefs(p)
    if (resync) void syncJira().catch(() => undefined)
    return resync
  },
  'jira.guess': () => withAi(() => guessJira()),
  'jira.sync': () => syncJira().then(() => true),
  'measure.list': () => currentMeasures(),
  'initiative.get': (key: string) => {
    const snap = getSnapshot()
    const i = snap?.initiatives.find((x) => x.key.toUpperCase() === key.toUpperCase())
    if (!snap || !i) return null
    const roadNotes = listRoadNotes(i.key).slice().reverse()
    const linked = new Map<string, { id: string; title: string }>()
    for (const n of roadNotes) if (n.noteId && db.getNote(n.noteId)) linked.set(n.noteId, { id: n.noteId, title: n.noteTitle ?? '' })
    for (const n of db.searchNotes(i.key, 10)) if (!linked.has(n.id)) linked.set(n.id, { id: n.id, title: n.title })
    return {
      initiative: i,
      path: stagePath(i.status),
      nextStep: nextStepFor(i, snap, new Date()),
      work: sprintRowFor(i, snap, new Date()),
      measure: currentMeasures().find((m) => m.key === i.key) ?? null,
      roadNotes,
      notes: [...linked.values()]
    }
  },
  'roadnotes.mark': (id: string, registered: boolean) => {
    markRoadNote(id, registered)
    dataChanged('jira')
    return true
  },
  'measure.plan': () => withAi(() => planMeasurements()),
  'measure.setDate': (key: string, date: string) => setMeasureDate(key, date),
  'measure.record': (key: string, text: string) => recordMeasure(key, text),

  // hoy
  'today.get': () => todayView(),
  'brief.check': (eventId: string, text: string, on: boolean) => {
    const b = db.getBrief(toDay(new Date()))
    if (b) db.saveBrief(toggleCheck(b, eventId, text, on))
    dataChanged('brief')
    return true
  },
  'brief.generate': async (useAI: boolean) => {
    const b = useAI ? await withAi(() => generateBrief(true)) : await generateBrief(false)
    dataChanged('brief')
    return b
  },

  'brief.react': (agree: boolean, reason?: string) => {
    const b = db.getBrief(toDay(new Date()))
    if (b) db.setSetting('weekly.answered', b.generatedAt)
    const w = b?.weekly ?? ''
    if (!agree) learn('lo que toca esta semana', `${reason ? `Dijo: «${reason}»` : 'No estaba de acuerdo'} (sobre «${w.length > 90 ? `${w.slice(0, 90)}…` : w}»)`)
    dataChanged('brief')
    return true
  },
  'flow.hide': (key: string, how: 'later' | 'notNeeded' | 'done', title: string) => {
    hideFlow(key, how, title)
    dataChanged('brief')
    return true
  },
  'learning.list': () => listLessons().slice().reverse(),
  'learning.forget': (at: string) => {
    forgetLesson(at)
    dataChanged('workflow')
    return true
  },

  // novedades
  'news.get': () => ({ pending: pendingNews(), running: newsRunning(), last: lastNewsAt() }),
  'news.review': () => withAi(() => reviewNews()),
  'news.decide': (id: string, d: NewsDecision) => decideNews(id, d),

  // encargos: lo que te piden otras personas
  'encargos.get': () => {
    const date = toDay(new Date())
    const areas = db.listAreas()
    const active = rankItems(db.listItems({ status: ['active'] }).filter((i) => i.kind === 'promise'), date, areas)
    const done = db
      .listItems({ status: ['done'] })
      .filter((i) => i.kind === 'promise')
      .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
      .slice(0, 40)
      .map((i) => scoreItem(i, date, areas))
    return { date, areas, active, done }
  },

  // elementos
  'items.list': (filter) => db.listItems(filter),
  'items.get': (id: string) => db.getItem(id),
  'items.create': (p) => {
    const i = db.createItem(p)
    dataChanged('items')
    return i
  },
  'items.update': (id: string, patch) => {
    const i = db.updateItem(id, patch)
    dataChanged('items')
    return i
  },
  'items.delete': (id: string) => {
    db.deleteItem(id)
    dataChanged('items')
    return true
  },

  // notas
  'notes.list': () => db.listNotes(),
  'notes.get': (id: string) => db.getNote(id),
  'notes.create': (parentId?: string | null) => {
    const n = db.createNote('', parentId ?? null)
    dataChanged('notes')
    return n
  },
  'notes.save': (id: string, title: string, json: string, plain: string) => {
    const n = db.saveNote(id, title, json, plain)
    dataChanged('notes') // para que la lista y las migas de pan muestren el título nuevo
    return n
  },
  'notes.delete': (id: string) => {
    db.deleteNote(id)
    dataChanged('notes')
    return true
  },
  'notes.move': (id: string, parentId: string | null) => {
    const ok = db.moveNote(id, parentId)
    dataChanged('notes')
    return ok
  },
  'notes.extract': (id: string, force?: boolean) => extractNote(id, !!force),
  'notes.search': (q: string) => db.searchNotes(q, 20),
  'meeting.note': (eventId: string) => {
    const e = db.listEvents(dayRange(addDays(toDay(new Date()), -30)).from, dayRange(addDays(toDay(new Date()), 60)).to).find((x) => x.id === eventId)
    if (!e) throw new Error('No encuentro esa reunión en tu calendario.')
    const id = noteForMeeting(e)
    dataChanged('notes')
    return id
  },
  'notes.review': (id: string) => withAi(() => reviewNote(id)),
  /** Reparte lo revisado: encargos a tu lista; lo de Jira se lo pasa a Claude (que pide OK antes de escribir). */
  'notes.distribute': (id: string, chosen: ReviewEntry[], skipped: ReviewEntry[]) => {
    const note = db.getNote(id)
    for (const e of chosen.filter((x) => x.tag === 'ENCARGO'))
      db.createItem({ kind: 'promise', title: e.text, person: e.person, dueDate: null, prepDays: 0, areaId: null, status: 'active', sourceType: 'note', sourceRef: id, sourceSnippet: null, sourceTool: null, context: `De la nota «${note?.title ?? ''}»` })
    // Lo que la detección automática había propuesto de esta nota ya queda repartido.
    for (const i of db.listItems({ status: ['proposed'] }).filter((x) => x.sourceRef === id))
      db.updateItem(i.id, { status: 'dismissed', dismissReason: 'Repartido al revisar la nota' })
    addRoadNotes(
      chosen
        .filter((e) => e.tag !== 'ENCARGO' && e.roadKey)
        .map((e) => ({ key: e.roadKey!, tag: e.tag, text: e.text + (e.person ? ` (${e.person})` : ''), noteId: id, noteTitle: note?.title ?? null }))
    )
    for (const e of skipped) learn('repartir notas', `No quiso repartir: [${e.tag}] ${e.text}`)
    dataChanged('items')
    db.setSetting(`note.distributed.${id}`, new Date().toISOString())
    return true
  },

  // entradas
  capture: (text: string) => withAi(() => capture(text)),
  transcript: (text: string, title: string) => withAi(() => importTranscript(text, title)),
  'file.import': async () => {
    const win = BrowserWindow.getFocusedWindow()
    const r = await dialog.showOpenDialog(win!, {
      title: 'Elige un archivo para analizar',
      properties: ['openFile'],
      filters: [{ name: 'Documentos', extensions: ['pdf', 'txt', 'md', 'markdown', 'csv', 'html', 'eml', 'vtt', 'srt'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    return withAi(() => importFile(r.filePaths[0]))
  },

  // mi flujo
  'workflow.get': () => db.getWorkflow(),
  'workflow.save': (md: string) => {
    const r = db.saveWorkflow(md)
    dataChanged('workflow')
    return r
  },
  'workflow.versions': () => db.listWorkflowVersions(),
  'workflow.version': (v: number) => db.getWorkflowVersion(v),
  'workflow.suggest': () =>
    withAi(() => suggestRules()).then((r) => {
      markSuggested()
      dataChanged('brief')
      return r
    }),
  'workflow.appendRule': (section: string, rule: string) => {
    const md = appendToSection(db.getWorkflow().markdown, section, rule)
    db.saveWorkflow(md)
    dataChanged('workflow')
    return db.getWorkflow()
  },
  'workflow.export': async () => {
    const win = BrowserWindow.getFocusedWindow()
    const r = await dialog.showSaveDialog(win!, { title: 'Exportar Mi flujo como skill', defaultPath: 'SKILL.md' })
    if (r.canceled || !r.filePath) return null
    const md = db.getWorkflow().markdown
    const skill = `---\nname: mi-flujo\ndescription: Cómo trabaja el usuario: prioridades, reglas, personas clave y permisos. Úsalo para priorizar, planificar o actuar en su nombre.\n---\n\n${md}`
    await writeFile(r.filePath, skill, 'utf8')
    return r.filePath
  },

  // áreas
  'areas.list': () => db.listAreas(),
  'areas.upsert': (a) => {
    const r = db.upsertArea(a)
    dataChanged('areas')
    return r
  },
  'areas.delete': (id: string) => {
    db.deleteArea(id)
    dataChanged('areas')
    return true
  },

  // fuentes y herramientas
  'sources.list': () => db.listSources(),
  'sources.upsert': async (s) => {
    const src = db.upsertSource(s)
    if (src.kind === 'ics') await syncIcs(src).catch(() => undefined)
    dataChanged('sources')
    return db.listSources().find((x) => x.id === src.id)
  },
  'sources.delete': (id: string) => {
    db.deleteSource(id)
    dataChanged('sources')
    dataChanged('events')
    return true
  },
  'sources.sync': async (id: string) => {
    const s = db.listSources().find((x) => x.id === id)
    if (!s) return 0
    return s.kind === 'ics' ? syncIcs(s) : withAi(() => syncMcpSource(s))
  },
  'connectors.list': async (refresh?: boolean) => {
    try {
      return await listClaudeConnectors(agentEnv(), !!refresh)
    } catch (e) {
      throw new Error(friendlyError(e))
    }
  },
  'connectors.syncCalendars': () => withAi(() => syncConnectorCalendars(true)),
  'connectors.toggle': (name: string, on: boolean) => {
    const cur = getSettings().claudeConnectorsOff.filter((n) => n !== name)
    updateSettings({ claudeConnectorsOff: on ? cur : [...cur, name] })
    dataChanged('mcp')
    if (isCalendarConnector(name)) {
      if (on) void syncConnectorCalendars(true).catch(() => undefined)
      else {
        db.replaceEvents(connectorEventsSourceId(name), [])
        dataChanged('events')
      }
    }
    const label = connectorLabel(name).toLowerCase()
    const hasRule = parsePermissions(db.getWorkflow().markdown).some((r) => r.pattern.toLowerCase().replace(/\s+/g, '_').startsWith(label.replace(/\s+/g, '_')))
    return { hasRule }
  },
  'mcp.list': () => db.listMcpServers(),
  'mcp.upsert': (s) => {
    if (!/^[a-zA-Z0-9-]+$/.test(s.name)) throw new Error('El nombre solo puede tener letras, números y guiones.')
    const r = db.upsertMcpServer(s)
    dataChanged('mcp')
    return r
  },
  'mcp.delete': (id: string) => {
    db.deleteMcpServer(id)
    dataChanged('mcp')
    return true
  },

  // resolver y preguntar
  'chat.start': (itemId: string | null, text: string, drafts: boolean, where?: string) => chatStart(itemId, text, drafts, where),
  'chat.send': (runId: string, text: string, drafts: boolean, where?: string) => chatSend(runId, text, drafts, where),
  'chat.stop': (runId: string) => chatStop(runId),
  'chat.close': (runId: string) => chatClose(runId),
  'runs.list': () => db.listRuns(),
  'history.get': () => buildHistory(db.listItems({ status: ['done', 'dismissed'] }), db.listRuns(1000)),
  'runs.get': (id: string) => db.getRun(id),
  'approvals.answer': (id: string, approved: boolean, always?: boolean) => answerApproval(id, approved, !!always),

  'shell.open': (url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return true
  }
}

export function registerIpc(): void {
  ipcMain.handle('api', async (_e, method: string, ...args: unknown[]) => {
    const fn = api[method]
    if (!fn) return { ok: false, error: `Método desconocido: ${method}` }
    try {
      return { ok: true, data: await fn(...args) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
