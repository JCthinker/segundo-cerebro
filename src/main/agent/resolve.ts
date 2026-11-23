import type { ActionRun, RunLogEntry } from '@shared/types'
import { KIND_LABEL } from '@shared/types'
import * as db from '../db'
import { dataChanged, emit } from '../events'
import { cerebroServer, connectedToolsSummary, userMcpServers } from './app-mcp'
import { baseSystem } from './context'
import { friendlyError, markAiFailure, markAiOk, runAgent } from './client'
import { makeGate } from './permissions-gate'

const running = new Map<string, AbortController>()

const RESOLVE_ROLE = `Eres el asistente personal del usuario y ahora vas a RESOLVER trabajo por él usando sus herramientas.
Forma de trabajar:
1. Busca contexto primero (notas, elementos, herramientas de lectura) para entender qué hay que hacer.
2. Explica en una frase tu plan antes de actuar.
3. Ejecuta los pasos. Las acciones que escriben o envían algo pasan por los permisos del usuario: algunas se ejecutan solas, otras esperan su OK y otras solo se dejan en borrador. Si una acción se rechaza o queda en borrador, no insistas: sigue con lo demás.
4. Si la tarea queda resuelta de verdad, márcala como hecha con cerebro update_item (status "done"). Si solo quedaron borradores, no la marques.
5. Termina con un resumen corto: qué hiciste, qué quedó en borrador (con el texto completo del borrador) y qué tiene que hacer el usuario.
No inventes datos: si te falta algo, dilo.`

export function startResolve(itemId: string | null, goal: string, mode: 'normal' | 'drafts'): ActionRun {
  const item = itemId ? db.getItem(itemId) : null
  const run = db.createRun(itemId, goal || item?.title || 'Tarea', mode)
  const ac = new AbortController()
  running.set(run.id, ac)

  const log = (e: RunLogEntry) => {
    db.appendRunLog(run.id, e)
    emit('run-updated', db.getRun(run.id))
  }

  const itemText = item
    ? `Elemento a resolver (id ${item.id}):
- Tipo: ${KIND_LABEL[item.kind]}
- Título: ${item.title}
- Persona: ${item.person ?? '—'}
- Vence: ${item.dueDate ?? 'sin fecha'}
- Origen: ${item.sourceType}${item.sourceRef ? ` (${item.sourceRef})` : ''}${item.sourceSnippet ? `\n- Frase de origen: «${item.sourceSnippet}»` : ''}`
    : ''

  void (async () => {
    try {
      const r = await runAgent({
        system: baseSystem(RESOLVE_ROLE) + `\n\n${await connectedToolsSummary()}`,
        prompt: `${itemText}\n\nLo que quiere el usuario: ${goal || 'Resuélvelo.'}${mode === 'drafts' ? '\n\nEl usuario ha pedido SOLO BORRADORES: no ejecutes nada que escriba o envíe; prepáralo todo para que lo revise.' : ''}`,
        mcpServers: { cerebro: cerebroServer({ allowWrites: true, onChange: () => dataChanged('items') }), ...userMcpServers() },
        canUseTool: makeGate(run.id, { draftsOnly: mode === 'drafts', log }),
        connectors: 'enabled',
        effort: 'high',
        maxTurns: 30,
        abortController: ac,
        onEvent: (e) => {
          if (e.type === 'text') log({ at: new Date().toISOString(), type: 'text', text: e.text })
          else log({ at: new Date().toISOString(), type: 'tool', text: e.text, toolName: e.toolName, input: e.input })
        }
      })
      markAiOk()
      log({ at: new Date().toISOString(), type: 'result', text: r.text })
      db.setRunStatus(run.id, 'done')
    } catch (e) {
      if (ac.signal.aborted) {
        db.setRunStatus(run.id, 'cancelled')
      } else {
        markAiFailure(e)
        log({ at: new Date().toISOString(), type: 'error', text: friendlyError(e) })
        db.setRunStatus(run.id, 'error')
      }
    } finally {
      running.delete(run.id)
      emit('run-updated', db.getRun(run.id))
      dataChanged('items')
    }
  })()

  return run
}

export function cancelRun(runId: string): void {
  running.get(runId)?.abort()
}
