import { dialog, ipcMain, shell, BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { addDays, toDay } from '@shared/dates'
import { rankItems } from '@shared/priority'
import type { ResolvePlan, TodayView } from '@shared/types'
import * as db from './db'
import { dataChanged } from './events'
import { getSettings, updateSettings } from './settings'
import { seedDemo, seedTemplateOnly } from './seed'
import { agentEnv, cachedAiStatus, friendlyError, markAiFailure, markAiOk, testAi } from './agent/client'
import { connectorLabel, listClaudeConnectors } from './agent/connectors'
import { parsePermissions } from '@shared/permissions'
import { dayRange, generateBrief } from './agent/brief'
import { extractToInbox } from './agent/extract'
import { cancelRun, planResolve, startResolve } from './agent/resolve'
import { ask, type ChatMessage } from './agent/ask'
import { claudeUsage } from './agent/usage'
import { answerApproval } from './agent/permissions-gate'
import { appendToSection, suggestRules } from './agent/suggest-rules'
import { capture, connectorEventsSourceId, importFile, importTranscript, isCalendarConnector, syncConnectorCalendars, syncIcs, syncMcpSource } from './sources'
import { shortcutLabel } from './shortcut'
import { checkForUpdate, installNow, updateStatus } from './updater'

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
  return {
    date,
    ranked: rankItems(db.listItems({ status: ['active'] }), date, areas),
    events: db.listEvents(from, to),
    brief: db.getBrief(date),
    areas,
    proposedCount: proposed.length,
    proposed
  }
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

  // hoy
  'today.get': () => todayView(),
  'brief.generate': async (useAI: boolean) => {
    const b = useAI ? await withAi(() => generateBrief(true)) : await generateBrief(false)
    dataChanged('brief')
    return b
  },

  // elementos
  'items.list': (filter) => db.listItems(filter),
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
  'workflow.suggest': () => withAi(() => suggestRules()),
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
  'resolve.plan': (itemId: string | null, goal: string, mode: 'normal' | 'drafts') => withAi(() => planResolve(itemId, goal, mode)),
  'resolve.start': (itemId: string | null, goal: string, mode: 'normal' | 'drafts', plan?: ResolvePlan | null) => startResolve(itemId, goal, mode, plan),
  'resolve.cancel': (runId: string) => cancelRun(runId),
  'runs.list': () => db.listRuns(),
  'runs.get': (id: string) => db.getRun(id),
  'approvals.answer': (id: string, approved: boolean) => answerApproval(id, approved),
  ask: (history: ChatMessage[]) => withAi(() => ask(history)),

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
