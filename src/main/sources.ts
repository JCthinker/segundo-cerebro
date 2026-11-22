import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { toDay } from '@shared/dates'
import type { Source } from '@shared/types'
import * as db from './db'
import { loadIcs, parseIcs } from './calendar'
import { dataChanged } from './events'
import { userMcpServers } from './agent/app-mcp'
import { connectorLabel, isConnectorName } from './agent/connectors'
import { baseSystem } from './agent/context'
import { friendlyError, markAiFailure, markAiOk, runAgent } from './agent/client'
import { extractToInbox, ITEMS_SCHEMA, saveProposals, type Extracted } from './agent/extract'
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
}

// ---------- fuentes MCP (Slack, Jira, correo…) → bandeja ----------
const MCP_PULL_ROLE = `Eres el lector de fuentes del «segundo cerebro». Usas SOLO herramientas de lectura de la herramienta indicada para encontrar lo que pide el usuario y detectar promesas, entregas, tareas y decisiones que le afecten.
- No escribas ni envíes nada.
- En "ref" pon el enlace o identificador del mensaje, correo o ticket.
- No dupliques lo ya conocido.`

export async function syncMcpSource(source: Source): Promise<number> {
  const server = String(source.config.server ?? '')
  const instructions = String(source.config.instructions ?? 'Lo que me afecte de los últimos 2 días')
  const known = db.listItems({ status: ['proposed', 'active'] }).slice(0, 60).map((i) => `- ${i.title}`).join('\n')
  try {
    const r = await runAgent({
      system: baseSystem(MCP_PULL_ROLE),
      prompt: `Herramienta: ${isConnectorName(server) ? connectorLabel(server) : server}\nQué buscar: ${instructions}\n\nYa conocido:\n${known || '(nada)'}`,
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
    const n = saveProposals((r.structured as { items: Extracted[] } | null)?.items ?? [], 'mcp', isConnectorName(server) ? connectorLabel(server) : server)
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
