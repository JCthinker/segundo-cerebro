import type { ItemKind, SourceType } from '@shared/types'
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
  ref?: string | null
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
        required: ['kind', 'title', 'person', 'dueDate', 'prepDays', 'area', 'snippet', 'ref'],
        properties: {
          kind: { type: 'string', enum: ['promise', 'deadline', 'task', 'decision'] },
          title: { type: 'string', description: 'Acción breve en infinitivo, p. ej. «Enviar el informe a Ana»' },
          person: { type: ['string', 'null'], description: 'A quién se le prometió o de quién depende' },
          dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD; resuelve fechas relativas respecto a hoy' },
          prepDays: { type: 'integer', minimum: 0, description: 'Días de trabajo necesarios antes de la fecha' },
          area: { type: ['string', 'null'], description: 'Una de las áreas del usuario, si encaja' },
          snippet: { type: 'string', description: 'Frase literal del texto de donde sale' },
          ref: { type: ['string', 'null'], description: 'Enlace o identificador de origen (URL, clave de ticket…), si lo hay' }
        }
      }
    }
  }
} as const

const EXTRACT_ROLE = `Eres el extractor del «segundo cerebro» del usuario. Lees un texto (una nota, un correo, un acta, un mensaje…) y detectas:
- promise: algo que el usuario se comprometió a hacer para otra persona («te lo paso el viernes»).
- deadline: una entrega o fecha límite.
- task: algo que el usuario tiene que hacer, sin otra persona esperando.
- decision: una decisión tomada que conviene recordar.
Reglas:
- Solo lo que esté en el texto. Si dudas, no lo incluyas.
- No dupliques lo que ya existe en la lista de elementos conocidos.
- Si el usuario es quien recibe la promesa de otra persona, no es una promesa suya: como mucho, una tarea de seguimiento si lo pide el texto.
- Usa las reglas de «Mi flujo» para estimar plazos implícitos y márgenes de preparación (por ejemplo, «lo que pide Marta tiene 48 horas»).`

/** Analiza un texto y guarda lo detectado como propuestas en la bandeja. Devuelve cuántas se crearon. */
export async function extractToInbox(p: {
  text: string
  sourceType: SourceType
  sourceRef: string | null
  label: string
}): Promise<number> {
  if (p.text.trim().length < 8) return 0
  const known = db
    .listItems({ status: ['proposed', 'active'] })
    .slice(0, 80)
    .map((i) => `- ${i.title}${i.person ? ` (${i.person})` : ''}${i.dueDate ? ` · ${i.dueDate}` : ''}`)
    .join('\n')

  const r = await runAgent({
    system: baseSystem(EXTRACT_ROLE),
    prompt: `Elementos ya conocidos:\n${known || '(ninguno)'}\n\nTexto a analizar (${p.label}):\n<texto>\n${p.text.slice(0, 60_000)}\n</texto>`,
    outputSchema: ITEMS_SCHEMA,
    effort: 'low',
    maxTurns: 3
  })
  return saveProposals((r.structured as { items: Extracted[] } | null)?.items ?? [], p.sourceType, p.sourceRef)
}

export function saveProposals(items: Extracted[], sourceType: SourceType, sourceRef: string | null): number {
  let created = 0
  for (const x of items) {
    if (!x.title?.trim()) continue
    const ref = x.ref || sourceRef
    if (db.proposalExists(ref, x.title)) continue
    const due = x.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(x.dueDate) ? x.dueDate : null
    db.createItem({
      kind: x.kind,
      title: x.title,
      person: x.person || null,
      dueDate: due,
      prepDays: Math.max(0, Math.round(x.prepDays || 0)),
      areaId: db.findAreaByName(x.area)?.id ?? null,
      status: 'proposed',
      sourceType,
      sourceRef: ref,
      sourceSnippet: x.snippet || null
    })
    created++
  }
  return created
}
