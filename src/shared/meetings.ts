/**
 * Reuniones: de qué tipo es cada una y qué hay que llevar preparado, sacado de Jira sin IA.
 */
import { addDays, toDay } from './dates'
import { buildBoard, type BoardCard, type JiraSnapshot } from './jira'
import type { CalendarEvent, Item } from './types'

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

/** Tipo de reunión que nombra una tarea. Más estricto que `meetingType`: «review» o «discovery» sueltos son trabajo, no reuniones. */
function mentionedType(text: string): MeetingType | null {
  if (/grooming|refinement|refinamiento/.test(text)) return 'grooming'
  if (/sprint ?planning|\bplanning\b|planificacion (de|del) sprint/.test(text)) return 'planning'
  if (/\bdaily\b|\bdailies\b|stand.?up/.test(text)) return 'daily'
  if (/sprint ?review|\bretro\b|retrospectiva|\bdemo\b/.test(text)) return 'review'
  if (/(reunion|sesion|meeting) (de )?discovery/.test(text)) return 'discovery'
  return null
}

/** Palabras que no distinguen una reunión de otra. */
const GENERIC = new Set(
  'reunion reuniones meeting sync semanal weekly quincenal mensual equipo team call llamada con del de la el los las y para por sobre sesion session the and with una uno sprint'.split(' ')
)
const words = (s: string) => norm(s).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !GENERIC.has(w))
/** La tarea dice que es para hablarlo o llevarlo a una reunión. */
const CUE = /\b(reunion|meeting|1:1|1-1|one ?on ?one|sync|comite|llamada|call|comentar|preguntar|hablar|plantear|contar|llevar|presentar|proponer|mencionar|sacar|tratar|revisar con|repasar con)\b/

/** Nombre de un asistente en palabras: «ana.lopez@empresa.com» → ana, lopez. */
const personWords = (a: string) => words(a.split('@')[0].replace(/[._-]/g, ' '))

/** ¿Esta tarea es para esta reunión? */
export function taskIsForMeeting(item: Pick<Item, 'title' | 'context' | 'person'>, e: CalendarEvent): boolean {
  const text = norm(`${item.title} ${item.context ?? ''}`)
  const own = new Set(words(text))
  const type = meetingType(e.title)
  if (type !== 'other' && mentionedType(text) === type) return true
  const cue = CUE.test(text)
  // El título de la reunión aparece en la tarea: «Sync pagos» ↔ «Llevar al sync de pagos los números».
  const title = words(e.title)
  const inTitle = title.filter((w) => own.has(w)).length
  if (title.length && inTitle === title.length && (title.length >= 2 || cue)) return true
  if (!cue) return false
  // La persona de la tarea (o alguien nombrado en ella) va a la reunión: «Comentar con Ana el precio» y un 1:1 con Ana.
  const people = [...(item.person ? personWords(item.person) : []), ...own]
  const small = e.attendees.length > 0 && e.attendees.length <= 4
  return small && e.attendees.some((a) => {
    const name = personWords(a)
    return name.length > 0 && people.includes(name[0])
  })
}

/**
 * Coloca cada tarea en la primera reunión de la que habla, entre hoy y su fecha límite
 * (o la próxima semana si no tiene). Devuelve id de reunión → ids de tareas.
 */
export function tasksByMeeting(items: Pick<Item, 'id' | 'title' | 'context' | 'person' | 'dueDate'>[], events: CalendarEvent[], now: Date): Map<string, string[]> {
  const today = toDay(now)
  const meetings = events
    .filter((e) => !e.allDay && toDay(new Date(e.start)) >= today && toDay(new Date(e.start)) <= addDays(today, 6))
    .sort((a, b) => a.start.localeCompare(b.start))
  const out = new Map<string, string[]>()
  for (const i of items) {
    const until = i.dueDate ?? addDays(today, 6)
    const e = meetings.find((m) => toDay(new Date(m.start)) <= until && taskIsForMeeting(i, m))
    if (e) out.set(e.id, [...(out.get(e.id) ?? []), i.id])
  }
  return out
}
