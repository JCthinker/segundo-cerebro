import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { toDay } from '@shared/dates'
import type { Source } from '@shared/types'
import * as db from './db'
import { loadIcs, parseIcs, toCalendarEvents, type ConnectorEvent } from './calendar'
import { dataChanged } from './events'
import { userMcpServers } from './agent/app-mcp'
import { connectorLabel, enabledConnectorNames, isConnectorName, knownConnectorNames } from './agent/connectors'
import { getSettings } from './settings'
import { baseSystem } from './agent/context'
import { agentEnv, friendlyError, markAiFailure, markAiOk, runAgent } from './agent/client'
import { extractToInbox, ITEMS_SCHEMA, knownForPrompt, saveProposals, type Extracted } from './agent/extract'
import { isReadOnlyTool } from '@shared/permissions'

// ---------- calendario ICS ----------
export async function syncIcs(source: Source): Promise<number> {
  const url = String(source.config.url ?? '')
  if (!url) return 0
  try {
    const text = await loadIcs(url)
    const from = new Date()
    from.setDate(from.getDate() - 1)
    from.setHours(0, 0, 0, 0)
    const to = new Date(from)
    to.setDate(to.getDate() + 45)
    const events = parseIcs(text, source.id, from, to)
    db.replaceEvents(source.id, events)
    db.markSourceSynced(source.id, null)
    dataChanged('events')
    return events.length
  } catch (e) {
    db.markSourceSynced(source.id, e instanceof Error ? e.message : String(e))
    dataChanged('sources')
    throw e
  }
}

export async function syncAllCalendars(): Promise<void> {
  for (const s of db.listSources()) {
    if (s.kind === 'ics' && s.enabled && s.config.url) await syncIcs(s).catch(() => undefined)
  }
  await syncConnectorCalendars().catch(() => undefined)
}

// ---------- calendario desde una conexión de claude.ai (Google Calendar, Outlook…) ----------
export function isCalendarConnector(name: string): boolean {
  return isConnectorName(name) && /calendar|calendario/i.test(connectorLabel(name))
}

export function connectorEventsSourceId(name: string): string {
  return `connector:${name}`
}

const EVENTS_SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Identificador del evento en el calendario' },
          title: { type: 'string' },
          start: { type: 'string', description: 'Inicio en ISO 8601 con zona horaria, p. ej. 2026-11-24T10:00:00+01:00. Para todo el día: AAAA-MM-DD' },
          end: { type: 'string', description: 'Fin en el mismo formato' },
          allDay: { type: 'boolean' },
          location: { type: ['string', 'null'] },
          attendees: { type: 'array', items: { type: 'string' } },
          description: { type: ['string', 'null'], description: 'Resumen corto (máx. 300 caracteres)' }
        },
        required: ['id', 'title', 'start', 'end', 'allDay', 'location', 'attendees', 'description']
      }
    }
  },
  required: ['events']
} as const


const CAL_ROLE = `Eres el lector de calendario del «segundo cerebro». Usa SOLO herramientas de lectura del calendario para listar los eventos del usuario en el rango pedido (todos sus calendarios principales). No crees, cambies ni borres nada. Omite los eventos cancelados o rechazados. Devuelve las horas exactamente como las da el calendario, con su zona horaria.`

const lastConnectorSync = new Map<string, number>()
const CONNECTOR_CAL_EVERY = 25 * 60_000

/** Trae las reuniones de las conexiones de calendario de claude.ai a la lista de eventos. */
export async function syncConnectorCalendars(force = false): Promise<number> {
  if (getSettings().aiMode === 'api-key') return 0
  const env = agentEnv()
  const enabled = new Set(await enabledConnectorNames(env))
  const calendars = knownConnectorNames().filter(isCalendarConnector)
  let total = 0
  let lastError: unknown = null
  for (const name of calendars) {
    if (!enabled.has(name)) {
      db.replaceEvents(connectorEventsSourceId(name), [])
      continue
    }
    if (!force && Date.now() - (lastConnectorSync.get(name) ?? 0) < CONNECTOR_CAL_EVERY) continue
    const from = new Date()
    from.setDate(from.getDate() - 1)
    from.setHours(0, 0, 0, 0)
    const to = new Date(from)
    to.setDate(to.getDate() + 15)
    try {
      const r = await runAgent({
        system: baseSystem(CAL_ROLE),
        prompt: `Lista mis eventos desde ${from.toISOString()} hasta ${to.toISOString()} (zona horaria del usuario: ${Intl.DateTimeFormat().resolvedOptions().timeZone}).`,
        connectors: [name],
        canUseTool: async (toolName, input) =>
          isReadOnlyTool(toolName)
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: 'Esta sincronización es de solo lectura.' },
        outputSchema: EVENTS_SCHEMA as unknown as Record<string, unknown>,
        effort: 'low',
        maxTurns: 10
      })
      markAiOk()
      const raw = (r.structured as { events: ConnectorEvent[] } | null)?.events ?? []
      const events = toCalendarEvents(raw, connectorEventsSourceId(name))
      db.replaceEvents(connectorEventsSourceId(name), events)
      lastConnectorSync.set(name, Date.now())
      total += events.length
    } catch (e) {
      markAiFailure(e)
      lastError = e
    }
  }
  dataChanged('events')
  if (lastError) throw new Error(friendlyError(lastError))
  return total
}


// ---------- fuentes MCP (Slack, Jira, correo…) → bandeja ----------
const MAX_NEW = 5

/** Qué merece una tarea: lo mismo para las lecturas programadas y el repaso de la mañana. */
const WHAT_TO_NOTE = `Qué apuntar:
- Solo lo que pida una acción del propio usuario según las reglas de «Mi flujo». Si «Mi flujo» dice en qué casos avisar o crear una tarea, limítate a esos casos. Lo informativo, lo que tienen que hacer otros y lo que no encaja en su flujo no se apunta.
- Un asunto = un elemento. Si del mismo tema se habla en varios canales, hilos, correos o herramientas, júntalo todo en uno solo (en "snippet", el fragmento más claro; en "ref", el enlace principal).
- Si un asunto ya está en la lista de lo apuntado o descartado, no lo incluyas, aunque venga de otro canal o con otras palabras.
- Como mucho ${MAX_NEW} elementos, los más importantes. Devolver la lista vacía es lo normal si no hay nada que cumpla esto.`

const MCP_PULL_ROLE = `Eres el lector de fuentes del «segundo cerebro». Usas SOLO herramientas de lectura de la herramienta indicada para encontrar lo que pide el usuario.
- No escribas ni envíes nada.
- En "ref" pon el enlace o identificador del mensaje, correo o ticket.

${WHAT_TO_NOTE}`

export async function syncMcpSource(source: Source): Promise<number> {
  const server = String(source.config.server ?? '')
  const instructions = String(source.config.instructions ?? 'Lo que me afecte de los últimos 2 días')
  const known = knownForPrompt()
  try {
    const r = await runAgent({
      system: baseSystem(MCP_PULL_ROLE),
      prompt: `Herramienta: ${isConnectorName(server) ? connectorLabel(server) : server}\nQué buscar: ${instructions}\n\n${known}`,
      ...(isConnectorName(server) ? { connectors: [server] } : { mcpServers: userMcpServers([server]) }),
      // Solo lectura: cualquier escritura se rechaza sin preguntar.
      canUseTool: async (toolName, input) =>
        isReadOnlyTool(toolName)
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: 'Esta sincronización es de solo lectura.' },
      outputSchema: ITEMS_SCHEMA,
      effort: 'medium',
      maxTurns: 15
    })
    markAiOk()
    const n = saveProposals((r.structured as { items: Extracted[] } | null)?.items ?? [], 'mcp', isConnectorName(server) ? connectorLabel(server) : server, MAX_NEW)
    db.markSourceSynced(source.id, null)
    dataChanged('items')
    return n
  } catch (e) {
    markAiFailure(e)
    db.markSourceSynced(source.id, friendlyError(e))
    dataChanged('sources')
    throw e
  }
}

/**
 * Lee una tras otra todas las herramientas de «Lecturas programadas» que estén activas
 * (Jira, Gmail…). Se usa antes de preparar el día, para que el orden tenga en cuenta
 * lo que hay en ellas. Si una falla, el error queda en su fila y las demás siguen.
 */
export async function syncAllPulls(): Promise<number> {
  const connectorsOn = new Set(await enabledConnectorNames(agentEnv()).catch(() => [] as string[]))
  const pulls = db.listSources().filter((s) => {
    if (s.kind !== 'mcp' || !s.enabled) return false
    const server = String(s.config.server ?? '')
    if (!server) return false
    return isConnectorName(server) ? connectorsOn.has(server) : true
  })
  // Una detrás de otra: así cada lectura ve lo que ya apuntó la anterior y no se repite.
  let total = 0
  for (const s of pulls) total += await syncMcpSource(s).catch(() => 0)
  return total
}

// ---------- archivos ----------
const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.html', '.htm', '.eml', '.ics', '.vtt', '.srt'])

export async function importFile(path: string): Promise<number> {
  const ext = extname(path).toLowerCase()
  const name = basename(path)
  if (TEXT_EXT.has(ext)) {
    const text = await readFile(path, 'utf8')
    const n = await extractToInbox({ text, sourceType: 'file', sourceRef: name, label: `archivo ${name}` })
    dataChanged('items')
    return n
  }
  if (ext === '.pdf') {
    // El PDF lo lee Claude con su herramienta Read, limitada a ese archivo.
    const r = await runAgent({
      system: baseSystem(
        'Eres el extractor del «segundo cerebro». Lee el documento indicado con la herramienta Read y detecta promesas, entregas, tareas y decisiones que afecten al usuario. Indica la página en el fragmento («pág. N: …»).'
      ),
      prompt: `Documento: ${path}`,
      builtinTools: ['Read'],
      canUseTool: async (toolName, input) =>
        toolName === 'Read' && (input as { file_path?: string }).file_path === path
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: 'Solo puedes leer el documento indicado.' },
      outputSchema: ITEMS_SCHEMA,
      effort: 'low',
      maxTurns: 6
    })
    const n = saveProposals((r.structured as { items: Extracted[] } | null)?.items ?? [], 'file', name)
    dataChanged('items')
    return n
  }
  throw new Error(`Todavía no sé leer archivos ${ext || 'sin extensión'}. Prueba con PDF, texto o Markdown.`)
}

export async function importTranscript(text: string, title: string): Promise<number> {
  const label = title.trim() || `Acta del ${toDay(new Date())}`
  const n = await extractToInbox({ text, sourceType: 'transcript', sourceRef: label, label: `acta «${label}»` })
  dataChanged('items')
  return n
}

export async function capture(text: string): Promise<number> {
  const n = await extractToInbox({ text, sourceType: 'capture', sourceRef: null, label: 'captura rápida' })
  dataChanged('items')
  return n
}

// ---------- repaso de todas las conexiones antes del brief ----------
const SWEEP_ROLE = `Eres el lector de fuentes del «segundo cerebro». Antes del resumen de la mañana repasas las herramientas conectadas del usuario (correo, chat, documentos, tickets…) usando SOLO herramientas de lectura.
Mira lo de las últimas 24 horas en cada herramienta disponible, pero sé breve: lo reciente e importante, no todo.
- No escribas ni envíes nada.
- En "ref" pon el enlace o identificador del mensaje, correo o ticket.

${WHAT_TO_NOTE}`

/**
 * Repasa las conexiones activas que no tienen ya una lectura propia en Entradas (ni son calendarios)
 * y deja lo nuevo en la bandeja. Devuelve cuántas cosas creó.
 */
export async function sweepConnectors(): Promise<number> {
  if (getSettings().aiMode === 'api-key') return 0
  const withPull = new Set(db.listSources().filter((s) => s.kind === 'mcp' && s.enabled).map((s) => String(s.config.server ?? '')))
  const names = (await enabledConnectorNames(agentEnv())).filter((n) => !isCalendarConnector(n) && !withPull.has(n))
  if (!names.length) return 0
  const known = knownForPrompt()
  const r = await runAgent({
    system: baseSystem(SWEEP_ROLE),
    prompt: `Herramientas: ${names.map(connectorLabel).join(', ')}\n\n${known}`,
    connectors: names,
    canUseTool: async (toolName, input) =>
      isReadOnlyTool(toolName)
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: 'Este repaso es de solo lectura.' },
    outputSchema: ITEMS_SCHEMA,
    effort: 'medium',
    maxTurns: 25
  })
  const n = saveProposals((r.structured as { items: Extracted[] } | null)?.items ?? [], 'mcp', 'Repaso de la mañana', MAX_NEW)
  if (n) dataChanged('items')
  return n
}
