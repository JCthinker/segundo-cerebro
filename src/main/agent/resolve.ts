import type { ActionRun, PlanStep, ResolvePlan, RunLogEntry } from '@shared/types'
import { isReadOnlyTool, parsePermissions, stepEffect } from '@shared/permissions'
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

function describeItem(itemId: string | null): string {
  const item = itemId ? db.getItem(itemId) : null
  return item
    ? `Elemento a resolver (id ${item.id}):
- Tipo: ${KIND_LABEL[item.kind]}
- Título: ${item.title}${item.context ? `\n- Contexto: ${item.context}` : ''}
- Persona: ${item.person ?? '—'}
- Vence: ${item.dueDate ?? 'sin fecha'}
- Origen: ${item.sourceTool ?? item.sourceType}${item.sourceRef ? ` (${item.sourceRef})` : ''}${item.sourceSnippet ? `\n- Frase de origen: «${item.sourceSnippet}»` : ''}`
    : ''
}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'steps', 'question'],
  properties: {
    summary: { type: 'string', description: 'Una frase sencilla, en segunda persona, con lo que conseguirás para el usuario' },
    steps: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'tool', 'kind'],
        properties: {
          text: { type: 'string', description: 'El paso en una frase corta y llana, sin jerga («Enviar a Ana el informe por correo»)' },
          tool: { type: ['string', 'null'], description: 'Herramienta que usará (Gmail, Slack, Jira…); null si es dentro de la app' },
          kind: {
            type: 'string',
            enum: ['read', 'app', 'write'],
            description: 'read = solo mirar o buscar; app = apuntar o marcar como hecha dentro de la app; write = escribir, crear, enviar o cambiar algo en una herramienta'
          }
        }
      }
    },
    question: { type: ['string', 'null'], description: 'Si te falta un dato imprescindible para hacerlo, la pregunta al usuario; si no, null' }
  }
} as const

const PLAN_ROLE = `Eres el asistente personal del usuario. Antes de actuar, le explicas en pocas palabras qué vas a hacer para que decida si sigue.
- Puedes mirar sus notas, tareas, agenda y herramientas (solo lectura) para entender el encargo, pero NO escribas ni envíes nada todavía.
- Pasos: entre 1 y 6, en el orden en que los harás, cada uno en una frase corta que entienda cualquiera. Junta lo que sea solo mirar en un paso.
- Si para hacerlo hay que escribir o enviar algo (un correo, un mensaje, un ticket), ponlo como paso aparte y di a quién y qué.
- Pregunta en "question" solo si sin ese dato es imposible hacerlo. Si puedes hacerlo con una suposición razonable, hazla y dila en el paso, y deja "question" en null.
- Si el usuario ya te ha contestado algo, úsalo: nunca repitas una pregunta que ya ha respondido.`

/** Claude mira el contexto (sin tocar nada) y explica qué hará y qué pasará con cada paso. */
export async function planResolve(itemId: string | null, goal: string, mode: 'normal' | 'drafts'): Promise<ResolvePlan> {
  const r = await runAgent({
    system: baseSystem(PLAN_ROLE) + `\n\n${await connectedToolsSummary()}`,
    prompt: `${describeItem(itemId)}\n\nLo que quiere el usuario: ${goal || 'Resuélvelo.'}${mode === 'drafts' ? '\n\nQuiere SOLO BORRADORES: nada se enviará.' : ''}`,
    mcpServers: { cerebro: cerebroServer({ allowWrites: false }), ...userMcpServers() },
    canUseTool: async (toolName, input) =>
      toolName.startsWith('mcp__cerebro__') || isReadOnlyTool(toolName)
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: 'Ahora solo estás preparando el plan: no escribas ni envíes nada.' },
    connectors: 'enabled',
    outputSchema: PLAN_SCHEMA as unknown as Record<string, unknown>,
    tier: 'quick',
    effort: 'medium',
    maxTurns: 12
  })
  markAiOk()
  const raw = r.structured as { summary: string; steps: Omit<PlanStep, 'effect'>[]; question: string | null } | null
  if (!raw) throw new Error('Claude no ha podido preparar el plan. Vuelve a intentarlo.')
  const rules = parsePermissions(db.getWorkflow().markdown)
  return {
    summary: raw.summary,
    question: raw.question?.trim() || null,
    steps: raw.steps.map((st) => ({ ...st, effect: stepEffect(st.kind, st.tool, rules, { draftsOnly: mode === 'drafts' }) }))
  }
}

export function startResolve(itemId: string | null, goal: string, mode: 'normal' | 'drafts', plan?: ResolvePlan | null): ActionRun {
  const item = itemId ? db.getItem(itemId) : null
  const run = db.createRun(itemId, goal || item?.title || 'Tarea', mode)
  const ac = new AbortController()
  running.set(run.id, ac)

  const log = (e: RunLogEntry) => {
    db.appendRunLog(run.id, e)
    emit('run-updated', db.getRun(run.id))
  }

  const itemText = describeItem(itemId)
  const planText = plan?.steps.length
    ? `\n\nPlan que el usuario ha visto y aprobado (síguelo; no hagas nada fuera de él):\n${plan.steps.map((st, i) => `${i + 1}. ${st.text}`).join('\n')}`
    : ''

  void (async () => {
    try {
      const r = await runAgent({
        system: baseSystem(RESOLVE_ROLE) + `\n\n${await connectedToolsSummary()}`,
        prompt: `${itemText}\n\nLo que quiere el usuario: ${goal || 'Resuélvelo.'}${planText}${mode === 'drafts' ? '\n\nEl usuario ha pedido SOLO BORRADORES: no ejecutes nada que escriba o envíe; prepáralo todo para que lo revise.' : ''}`,
        mcpServers: { cerebro: cerebroServer({ allowWrites: true, onChange: () => dataChanged('items') }), ...userMcpServers() },
        canUseTool: makeGate(run.id, { draftsOnly: mode === 'drafts', log }),
        connectors: 'enabled',
        tier: 'strong',
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
