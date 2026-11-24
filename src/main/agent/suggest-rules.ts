import * as db from '../db'
import { baseSystem } from './context'
import { runAgent } from './client'
import { dismissedWithReason } from './extract'
import { listLessons } from '../learning'

export interface RuleSuggestion {
  section: string
  rule: string
  evidence: string
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'rule', 'evidence'],
        properties: {
          section: { type: 'string', description: 'Título de una sección que ya exista en Mi flujo (por ejemplo «Reglas», «Groomings», «Encargos», «Mediciones»); «Reglas» si ninguna encaja' },
          rule: { type: 'string', description: 'La regla tal como se escribiría en Mi flujo, en primera persona' },
          evidence: { type: 'string', description: 'En qué te basas: notas o elementos concretos' }
        }
      }
    }
  }
} as const

/** Busca patrones repetidos en notas y compromisos que aún no estén en Mi flujo. Nunca escribe: solo sugiere. */
export async function suggestRules(): Promise<RuleSuggestion[]> {
  const notes = db
    .listNotes()
    .slice(0, 30)
    .map((n) => `## ${n.title || 'Sin título'} (${n.updatedAt.slice(0, 10)})\n${n.plain.slice(0, 1500)}`)
    .join('\n\n')
  const items = db
    .listItems({ status: ['active', 'done', 'renegotiated'] })
    .slice(0, 80)
    .map((i) => `- [${i.kind}/${i.status}] ${i.title}${i.person ? ` · ${i.person}` : ''}${i.dueDate ? ` · ${i.dueDate}` : ''}`)
    .join('\n')
  const dismissed = dismissedWithReason(60)
    .map((i) => `- «${i.title}»${i.sourceTool ? ` (de ${i.sourceTool})` : ''}: ${i.dismissReason}`)
    .join('\n')

  const r = await runAgent({
    system: baseSystem(
      `Ayudas al usuario a mantener su página «Mi flujo». Busca patrones REPETIDOS (al menos dos veces) en sus notas y compromisos que todavía no estén escritos en Mi flujo: plazos habituales de ciertas personas, tipos de tareas que siempre se retrasan, rituales implícitos, prioridades que se ven en la práctica. Lo más importante son sus correcciones (en «Lo que ha corregido»): cuando dice «No lo veo así», «No hace falta», lleva una novedad a otro sitio o descarta algo, está enseñando cómo trabaja. Si una corrección se repite o es clara, conviértela en regla. Fíjate también en los motivos por los que descarta propuestas: si se repiten, conviértelos en una regla de qué NO apuntarle (sección «Reglas»). No propongas nada que ya esté. Si no hay patrones claros, devuelve una lista vacía.`
    ),
    prompt: `Lo que ha corregido:\n${listLessons().slice(-60).map((l) => `- (${l.where}) ${l.text}`).join('\n') || '(nada)'}\n\nNotas recientes:\n${notes || '(ninguna)'}\n\nCompromisos:\n${items || '(ninguno)'}\n\nPropuestas descartadas y su motivo:\n${dismissed || '(ninguna)'}`,
    outputSchema: SCHEMA,
    tier: 'quick',
    effort: 'medium',
    maxTurns: 3
  })
  return (r.structured as { suggestions: RuleSuggestion[] } | null)?.suggestions ?? []
}

/** Añade una línea a la sección indicada de Mi flujo (la crea si no existe). */
export function appendToSection(markdown: string, section: string, line: string): string {
  const lines = markdown.split('\n')
  const idx = lines.findIndex((l) => new RegExp(`^#{1,6}\\s+${section}\\s*$`, 'i').test(l.trim()))
  const bullet = `- ${line.replace(/^[-*]\s+/, '')}`
  if (idx === -1) return `${markdown.trimEnd()}\n\n## ${section}\n${bullet}\n`
  let end = idx + 1
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end++
  let insertAt = end
  while (insertAt > idx + 1 && lines[insertAt - 1].trim() === '') insertAt--
  lines.splice(insertAt, 0, bullet)
  return lines.join('\n')
}
