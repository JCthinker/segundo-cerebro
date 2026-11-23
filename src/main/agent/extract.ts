import { onlyNew, toolFromRef } from '@shared/dedupe'
import type { Item, ItemKind, SourceType } from '@shared/types'
import * as db from '../db'
import { baseSystem } from './context'
import { runAgent } from './client'

export interface Extracted {
  kind: ItemKind
  title: string
  person: string | null
  dueDate: string | null
  prepDays: number
  area: string | null
  snippet: string
  context?: string | null
  ref?: string | null
  tool?: string | null
}

export const ITEMS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'context', 'person', 'dueDate', 'prepDays', 'area', 'snippet', 'ref', 'tool'],
        properties: {
          kind: { type: 'string', enum: ['promise', 'deadline', 'task', 'decision'] },
          title: { type: 'string', description: 'Acción breve en infinitivo, p. ej. «Enviar el informe a Ana»' },
          context: {
            type: 'string',
            description:
              'Una o dos frases para el usuario, en segunda persona: qué ha pasado, por qué le toca a él y qué tiene que hacer exactamente (p. ej. «Ana preguntó en #producto si el informe estará el jueves. Le dijiste que sí: envíaselo por correo antes del jueves.»)'
          },
          person: { type: ['string', 'null'], description: 'A quién se le prometió o de quién depende' },
          dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD; resuelve fechas relativas respecto a hoy. null si no hay fecha (se pondrá mañana)' },
          prepDays: { type: 'integer', minimum: 0, description: 'Días de trabajo necesarios antes de la fecha' },
          area: { type: ['string', 'null'], description: 'Una de las áreas del usuario, si encaja' },
          snippet: { type: 'string', description: 'Frase literal del texto de donde sale' },
          ref: { type: ['string', 'null'], description: 'Enlace o identificador de origen (URL, clave de ticket…), si lo hay' },
          tool: {
            type: ['string', 'null'],
            description:
              'Herramienta o herramientas de donde sale, separadas por comas si son varias (p. ej. «Slack» o «Slack, Jira»); null si es una nota o un texto'
          }
        }
      }
    }
  }
} as const

/** Igual, pero para lo leído de herramientas: siempre hay que decir de cuál (o cuáles) sale. */
export const TOOL_ITEMS_SCHEMA = (() => {
  const s = JSON.parse(JSON.stringify(ITEMS_SCHEMA))
  s.properties.items.items.properties.tool = {
    type: 'string',
    minLength: 2,
    description: 'Herramienta o herramientas de donde sale, con su nombre (Slack, Gmail, Jira, Google Drive…). Si sale de varias, sepáralas con comas: «Slack, Jira».'
  }
  return s as Record<string, unknown>
})()

const EXTRACT_ROLE = `Eres el extractor del «segundo cerebro» del usuario. Lees un texto (una nota, un correo, un acta, un mensaje…) y detectas:
- promise: algo que el usuario se comprometió a hacer para otra persona («te lo paso el viernes»).
- deadline: una entrega o fecha límite.
- task: algo que el usuario tiene que hacer, sin otra persona esperando.
- decision: una decisión tomada que conviene recordar.
Reglas:
- Solo lo que esté en el texto. Si dudas, no lo incluyas.
- No dupliques lo que ya existe en la lista de elementos conocidos ni lo que el usuario descartó.
- Nunca la misma tarea dos veces con otras palabras. Varias tareas distintas sobre un mismo asunto sí pueden salir.
- Si el usuario es quien recibe la promesa de otra persona, no es una promesa suya: como mucho, una tarea de seguimiento si lo pide el texto.
- Usa las reglas de «Mi flujo» para estimar plazos implícitos y márgenes de preparación (por ejemplo, «lo que pide Marta tiene 48 horas»).`

/** Analiza un texto y guarda lo detectado como propuestas en la bandeja. Devuelve cuántas se crearon. */
export async function extractToInbox(p: {
  text: string
  sourceType: SourceType
  sourceRef: string | null
  label: string
  /** 'active' cuando el usuario ha pedido apuntarlo: entra directo en su lista, sin confirmar. */
  status?: 'proposed' | 'active'
}): Promise<number> {
  if (p.text.trim().length < 8) return 0
  const known = knownForPrompt()

  const r = await runAgent({
    system: baseSystem(EXTRACT_ROLE),
    prompt: `${known}\n\nTexto a analizar (${p.label}):\n<texto>\n${p.text.slice(0, 60_000)}\n</texto>`,
    outputSchema: ITEMS_SCHEMA,
    tier: 'quick',
    effort: 'low',
    maxTurns: 3
  })
  return await saveProposals((r.structured as { items: Extracted[] } | null)?.items ?? [], p.sourceType, p.sourceRef, null, p.status)
}

/** Lo que ya existe o se descartó hace poco: con esto se evita volver a proponerlo. */
export function existingForDedupe(): Item[] {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const recentClosed = db.listItems({ status: ['done', 'dismissed', 'renegotiated'] }).filter((i) => i.updatedAt >= since)
  return [...db.listItems({ status: ['proposed', 'active'] }), ...recentClosed]
}

/** Lo descartado con motivo en los últimos 90 días: de aquí aprende Claude qué no proponer. */
export function dismissedWithReason(limit = 40): Item[] {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
  return db
    .listItems({ status: ['dismissed'] })
    .filter((i) => i.dismissReason && i.updatedAt >= since)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
}

/** Lista para el prompt: lo pendiente y lo descartado, para que Claude no lo repita. */
export function knownForPrompt(): string {
  const line = (i: Item) => `- ${i.title}${i.person ? ` (${i.person})` : ''}${i.dueDate ? ` · ${i.dueDate}` : ''}`
  const all = existingForDedupe()
  const open = all.filter((i) => i.status === 'proposed' || i.status === 'active').slice(0, 80).map(line)
  const closed = all.filter((i) => i.status !== 'proposed' && i.status !== 'active').slice(0, 40).map(line)
  const lessons = dismissedWithReason().map((i) => `- «${i.title}»${i.sourceTool ? ` (de ${i.sourceTool})` : ''}: ${i.dismissReason}`)
  return `Ya apuntado (no lo repitas, aunque aparezca en otro canal):\n${open.join('\n') || '(nada)'}\n\nYa hecho o descartado por el usuario (no lo vuelvas a proponer):\n${closed.join('\n') || '(nada)'}${
    lessons.length
      ? `\n\nPropuestas que el usuario descartó y por qué. Aprende de estos motivos: no propongas nada parecido por la misma razón.\n${lessons.join('\n')}`
      : ''
  }`
}

const SAME_TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['repetidas'],
  properties: { repetidas: { type: 'array', items: { type: 'integer' }, description: 'Números de las propuestas nuevas que repiten una tarea ya apuntada o de la misma lista' } }
} as const

/**
 * Segunda comprobación con Claude: quita las propuestas que son la misma tarea que otra
 * (ya apuntada o de la misma tanda) dicha con otras palabras. Si falla, se queda con todo.
 */
async function dropRewordings<T extends { title: string; person?: string | null }>(candidates: T[], existing: Item[]): Promise<T[]> {
  if (!candidates.length || (candidates.length < 2 && !existing.length)) return candidates
  const prev = existing.slice(0, 150).map((i) => `- ${i.title}${i.person ? ` (${i.person})` : ''}`).join('\n')
  const next = candidates.map((c, n) => `${n + 1}. ${c.title}${c.person ? ` (${c.person})` : ''}`).join('\n')
  try {
    const r = await runAgent({
      system:
        'Comparas listas de tareas. Una propuesta es repetida solo si pide hacer LO MISMO que otra tarea, aunque esté dicha con otras palabras. Dos tareas distintas sobre el mismo asunto o el mismo ticket NO son repetidas (por ejemplo, «Estimar FP-12» y «Describir FP-12»). Dentro de las propuestas nuevas, si dos son la misma, marca solo la segunda.',
      prompt: `Tareas ya apuntadas o descartadas:\n${prev || '(ninguna)'}\n\nPropuestas nuevas:\n${next}`,
      outputSchema: SAME_TASK_SCHEMA,
      tier: 'quick',
      effort: 'low',
      maxTurns: 2
    })
    const drop = new Set((r.structured as { repetidas: number[] } | null)?.repetidas ?? [])
    return candidates.filter((_, n) => !drop.has(n + 1))
  } catch {
    return candidates
  }
}

/**
 * Guarda lo detectado como propuestas en la bandeja, sin repetir tareas que ya existan
 * o se hayan descartado, aunque estén redactadas con otras palabras.
 */
export async function saveProposals(
  items: Extracted[],
  sourceType: SourceType,
  sourceRef: string | null,
  sourceTool: string | null = null,
  status: 'proposed' | 'active' = 'proposed'
): Promise<number> {
  const existing = existingForDedupe()
  const candidates = items.map((x) => {
    const ref = x.ref || sourceRef
    return { ...x, sourceRef: ref, sourceSnippet: x.snippet || null, sourceTool: x.tool?.trim() || sourceTool || toolFromRef(ref) }
  })
  const fresh = await dropRewordings(onlyNew(candidates, existing), existing)
  for (const x of fresh) {
    const due = x.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(x.dueDate) ? x.dueDate : null
    db.createItem({
      kind: x.kind,
      title: x.title,
      person: x.person || null,
      dueDate: due,
      prepDays: Math.max(0, Math.round(x.prepDays || 0)),
      areaId: db.findAreaByName(x.area)?.id ?? null,
      status,
      sourceType,
      sourceRef: x.sourceRef,
      sourceSnippet: x.sourceSnippet,
      sourceTool: x.sourceTool,
      context: x.context?.trim() || null
    })
  }
  return fresh.length
}
