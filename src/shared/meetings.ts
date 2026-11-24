/**
 * Reuniones: de qué tipo es cada una y qué hay que llevar preparado, sacado de Jira sin IA.
 */
import { buildBoard, type BoardCard, type JiraSnapshot } from './jira'

export type MeetingType = 'grooming' | 'planning' | 'discovery' | 'daily' | 'review' | 'other'

export const MEETING_LABEL: Record<MeetingType, string> = {
  grooming: 'Grooming',
  planning: 'Sprint planning',
  discovery: 'Discovery',
  daily: 'Daily',
  review: 'Sprint review',
  other: 'Reunión'
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function meetingType(title: string): MeetingType {
  const t = norm(title)
  if (/grooming|refinement|refinamiento/.test(t)) return 'grooming'
  if (/planning|planificacion/.test(t)) return 'planning'
  if (/discovery/.test(t)) return 'discovery'
  if (/daily|dailies|stand.?up/.test(t)) return 'daily'
  if (/review|demo|retro/.test(t)) return 'review'
  return 'other'
}

const short = (c: BoardCard) => `${c.key} «${c.title}»`

/** Lo que hay que llevar a la reunión según Jira. Vacío si no aplica. */
export function prepFromJira(type: MeetingType, snap: JiraSnapshot | null, now: Date): string[] {
  if (!snap) return []
  const board = buildBoard(snap, now)
  const col = (id: string) => board.find((c) => c.id === id)?.cards ?? []
  const out: string[] = []
  if (type === 'grooming') {
    for (const c of col('refine').slice(0, 3))
      out.push(`Solución para decidir · ${short(c)}: repasar el discovery${c.developers.length ? ` con ${c.developers.join(' y ')}` : ''} y llevar la propuesta visual`)
    for (const c of col('backlog').slice(0, 3)) out.push(`Problema nuevo · ${short(c)}: contar el problema y su KPI, y pedir voluntarios para el discovery`)
    if (!out.length) out.push('No hay nada en Backlog ni en Ready to refine: elige qué problemas contar')
  } else if (type === 'planning') {
    for (const c of col('dev')) out.push(c.warnings.length ? `${short(c)}: ${c.warnings.map((w) => w.text.toLowerCase()).join(', ')}` : `${short(c)}: lista para la sprint`)
    const q = col('dev').find((c) => c.quarterRank === 0)?.quarter
    out.push(q ? `Objetivo de la sprint ligado a las iniciativas de ${q}` : 'Objetivo de la sprint ligado a las iniciativas del trimestre')
    if (!col('dev').length) out.unshift('No hay iniciativas en Ready to dev')
  } else if (type === 'discovery') {
    for (const c of col('discovery').slice(0, 4)) out.push(`${short(c)}${c.developers.length ? ` con ${c.developers.join(' y ')}` : ' (sin desarrollador)'}: qué falta para decidir la solución`)
  }
  return out
}

/** Título de la nota de una reunión: «Grooming · 26 nov». */
export function meetingNoteTitle(title: string, start: string): string {
  return `${title} · ${new Date(start).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`
}
