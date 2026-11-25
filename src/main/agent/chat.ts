import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ActionRun, RunLogEntry } from '@shared/types'
import { KIND_LABEL } from '@shared/types'
import { requestTitle } from '@shared/history'
import { notesForPrompt } from '@shared/item-notes'
import * as db from '../db'
import { dataChanged, emit } from '../events'
import { cerebroServer, connectedToolsSummary, userMcpServers } from './app-mcp'
import { baseSystem } from './context'
import { friendlyError, markAiFailure, markAiOk, openSession, type AgentSession } from './client'
import { makeGate } from './permissions-gate'

/**
 * Conversaciones con Claude desde «Pedir algo» o «Resolver»: como en la app de Claude.
 * Le escribes, se pone a trabajar directamente y le puedes seguir hablando; al cerrar el panel,
 * la conversación termina. Lo que pasó queda en el Historial.
 */

const ROLE = `Eres el asistente personal del usuario dentro de su app «Segundo Cerebro». Trabajas como en la app de Claude: conversación natural y haces el trabajo directamente.
- Sus mensajes llevan al final «[Pantalla que tiene abierta…]»: úsalo para entender a qué se refiere con «esto», «esta iniciativa» o «esta nota». No lo menciones si no hace falta.
- No presentes planes para que los apruebe ni pidas permiso antes de empezar: ponte a ello. Si de verdad falta un dato imprescindible, pregúntalo una sola vez y en una frase.
- Tienes acceso a su ordenador (archivos y órdenes de terminal), a internet, a sus skills y a sus herramientas conectadas. Leer y buscar es libre.
- La app le pide OK automáticamente para lo que escribe, envía o cambia algo, según sus permisos de Mi flujo. Tú no le preguntes además en el chat: usa la herramienta y la app se encarga.
- Si una acción se rechaza o queda en borrador, no insistas ni la intentes de otra forma: sigue con lo demás y deja el contenido redactado en tu respuesta.
- Si te cuenta algo que tiene que hacer o un compromiso («le dije a Ana que el jueves le mando el informe»), apúntalo en su lista con cerebro add_item y dile qué has apuntado y para cuándo. No hagas nada más con ello hasta que te lo pida.
- Si te pregunta algo, búscalo (sus notas, tareas, agenda y herramientas) y contesta citando de dónde sale.
- Si no entiendes a qué se refiere o te falta contexto, pregúntale en una frase en vez de adivinar.
- Contesta SIEMPRE con un mensaje final: qué has hecho, qué has apuntado, qué no has podido hacer y por qué, o qué necesitas que te diga. Nunca termines en silencio.
- Si resuelves de verdad una tarea de su lista, márcala como hecha con cerebro update_item (status "done"). Si solo quedaron borradores, no la marques.
- Responde breve, en español llano y sin jerga técnica: qué has hecho, qué quedó en borrador (con el texto completo) y qué le toca hacer a él.
- No inventes datos: si te falta algo, dilo.`

interface Session {
  agent: AgentSession | null
  /** Mensajes escritos antes de que la conversación esté lista. */
  waiting: string[]
  drafts: boolean
  /** Mensajes que Claude todavía no ha terminado de contestar. */
  outstanding: number
  stopping: boolean
}

const sessions = new Map<string, Session>()

function describeItem(itemId: string | null): string {
  const item = itemId ? db.getItem(itemId) : null
  return item
    ? `Tarea de su lista (id ${item.id}):
- Tipo: ${KIND_LABEL[item.kind]}
- Título: ${item.title}${item.context ? `\n- Contexto: ${item.context}` : ''}
- Persona: ${item.person ?? '—'}
- Vence: ${item.dueDate ?? 'sin fecha'}
- Origen: ${item.sourceTool ?? item.sourceType}${item.sourceRef ? ` (${item.sourceRef})` : ''}${item.sourceSnippet ? `\n- Frase de origen: «${item.sourceSnippet}»` : ''}${notesForPrompt(db.listItemNotes(item.id))}`
    : ''
}

const DRAFTS_NOTE = '\n\n(Modo solo borradores: no envíes ni cambies nada; prepáralo todo para que lo revise.)'

function log(runId: string, e: RunLogEntry): void {
  db.appendRunLog(runId, e)
  emit('run-updated', db.getRun(runId))
}

function setStatus(runId: string, status: ActionRun['status']): void {
  db.setRunStatus(runId, status)
  emit('run-updated', db.getRun(runId))
  dataChanged('runs')
}

/** Empieza una conversación nueva. Devuelve enseguida; Claude contesta por «run-updated». */
/** Lo que tiene en pantalla, para que «esto» o «esta iniciativa» se entiendan. No se guarda en el historial. */
const screenNote = (where?: string) => (where?.trim() ? `\n\n[Pantalla que tiene abierta en la app: ${where.trim()}]` : '')

export function chatStart(itemId: string | null, text: string, drafts: boolean, where?: string): ActionRun {
  const item = itemId ? db.getItem(itemId) : null
  const said = text.trim()
  const run = db.createRun(itemId, item ? item.title : requestTitle(said), drafts ? 'drafts' : 'normal')
  if (said) log(run.id, { at: new Date().toISOString(), type: 'user', text: said })
  const first = [describeItem(itemId), said ? `Lo que te pide: ${said}` : 'Resuélvelo.'].filter(Boolean).join('\n\n')
  open(run.id, itemId, first + screenNote(where) + (drafts ? DRAFTS_NOTE : ''), drafts)
  dataChanged('runs')
  return db.getRun(run.id)!
}

/** Le escribe algo más. Si la conversación ya no estaba abierta (p. ej. tras reiniciar), la retoma con lo anterior. */
export function chatSend(runId: string, text: string, drafts: boolean, where?: string): void {
  const said = text.trim()
  const run = db.getRun(runId)
  if (!said || !run) return
  log(runId, { at: new Date().toISOString(), type: 'user', text: said })
  const msg = said + screenNote(where) + (drafts ? DRAFTS_NOTE : '')
  const s = sessions.get(runId)
  if (!s) {
    const before = run.log
      .filter((e) => e.type === 'user' || e.type === 'result')
      .slice(0, -1)
      .map((e) => `${e.type === 'user' ? 'Usuario' : 'Tú'}: ${e.text}`)
      .join('\n\n')
    open(runId, run.itemId, `${describeItem(run.itemId)}\n\nConversación hasta ahora:\n${before}\n\nAhora te dice: ${msg}`, drafts)
    return
  }
  s.drafts = drafts
  s.outstanding++
  setStatus(runId, 'running')
  if (s.agent) s.agent.send(msg)
  else s.waiting.push(msg)
}

/** «Detener»: para lo que está haciendo, pero la conversación sigue abierta. */
export async function chatStop(runId: string): Promise<void> {
  const s = sessions.get(runId)
  if (!s?.agent || !s.outstanding) return
  s.stopping = true
  await s.agent.q.interrupt().catch(() => undefined)
}

/** Al cerrar el panel: la conversación termina. */
export function chatClose(runId: string): void {
  const s = sessions.get(runId)
  if (!s) return
  sessions.delete(runId)
  s.agent?.close()
  if (s.outstanding) setStatus(runId, 'cancelled')
}

function open(runId: string, itemId: string | null, firstMessage: string, drafts: boolean): void {
  const s: Session = { agent: null, waiting: [firstMessage], drafts, outstanding: 1, stopping: false }
  sessions.set(runId, s)
  setStatus(runId, 'running')
  const logger = (e: RunLogEntry) => log(runId, e)

  void (async () => {
    try {
      const agent = await openSession({
        system: baseSystem(ROLE) + `\n\n${await connectedToolsSummary()}${itemId ? '\n\nLa conversación es sobre una tarea de su lista (te la describe en su primer mensaje).' : ''}`,
        mcpServers: { cerebro: cerebroServer({ allowWrites: true, onChange: () => dataChanged('items') }), ...userMcpServers() },
        canUseTool: makeGate(runId, { draftsOnly: () => s.drafts, log: logger }),
        connectors: 'enabled'
      })
      if (sessions.get(runId) !== s) return agent.close()
      s.agent = agent
      for (const m of s.waiting.splice(0)) agent.send(m)
      for await (const msg of agent.q as AsyncIterable<SDKMessage>) handle(runId, s, msg)
    } catch (e) {
      if (sessions.get(runId) !== s) return
      markAiFailure(e)
      logger({ at: new Date().toISOString(), type: 'error', text: friendlyError(e) })
      s.outstanding = 0
      setStatus(runId, 'error')
      sessions.delete(runId)
    }
  })()
}

function handle(runId: string, s: Session, msg: SDKMessage): void {
  const at = new Date().toISOString()
  if (msg.type === 'assistant') {
    // Lo que hacen los ayudantes de Claude por dentro no se enseña: solo lo suyo.
    if (msg.parent_tool_use_id) return
    for (const block of msg.message.content) {
      if (block.type === 'text' && block.text.trim()) log(runId, { at, type: 'text', text: block.text })
      else if (block.type === 'tool_use') log(runId, { at, type: 'tool', text: block.name, toolName: block.name, input: block.input })
    }
    return
  }
  if (msg.type !== 'result') return
  s.outstanding = Math.max(0, s.outstanding - 1)
  if (s.stopping) {
    s.stopping = false
    s.outstanding = 0
    setStatus(runId, 'cancelled')
    return
  }
  if (msg.subtype === 'success' && !msg.is_error) {
    markAiOk()
    log(runId, { at, type: 'result', text: msg.result })
  } else {
    const detail = msg.subtype === 'success' ? msg.result : 'errors' in msg && Array.isArray(msg.errors) ? msg.errors.join('; ') : msg.subtype
    log(runId, { at, type: 'error', text: friendlyError(new Error(detail || 'Algo ha fallado.')) })
  }
  if (!s.outstanding) setStatus(runId, msg.subtype === 'success' && !msg.is_error ? 'done' : 'error')
  dataChanged('items')
}
