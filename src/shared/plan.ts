import type { CalendarEvent, ScoredItem } from './types'
import { addDays, diffDays, parseDay, toDay } from './dates'

/** Una cosa por hacer colocada en el día en que toca ponerse con ella. */
export interface PlanEntry {
  s: ScoredItem
  /** «Empieza ya · vence el miércoles», o null si simplemente vence ese día. */
  note: string | null
}

export interface DayPlan {
  day: string
  events: CalendarEvent[]
  entries: PlanEntry[]
}

export interface Plan {
  overdue: PlanEntry[]
  days: DayPlan[]
  /** Con fecha, pero no hace falta empezar en los próximos días. */
  later: PlanEntry[]
  undated: ScoredItem[]
}

/** «el miércoles» si cae en la próxima semana; si no, «12 dic». */
export function dueLabel(today: string, due: string): string {
  const n = diffDays(today, due)
  if (n === 0) return 'hoy'
  if (n === 1) return 'mañana'
  if (n < 0) return n === -1 ? 'ayer' : `hace ${-n} días`
  const d = parseDay(due)
  if (n < 7) return `el ${d.toLocaleDateString('es-ES', { weekday: 'long' })}`
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

/**
 * Reparte lo pendiente en los próximos `n` días.
 * Cada elemento aparece una sola vez: el día en que hay que empezar
 * (fecha límite − días de preparación), nunca antes de hoy.
 */
export function planDays(ranked: ScoredItem[], events: CalendarEvent[], today: string, n = 7): Plan {
  const days: DayPlan[] = Array.from({ length: n }, (_, i) => ({ day: addDays(today, i), events: [], entries: [] }))
  const byDay = new Map(days.map((d) => [d.day, d]))
  const last = days[days.length - 1].day

  for (const e of events) {
    const d = e.allDay ? e.start.slice(0, 10) : toDay(new Date(e.start))
    byDay.get(d < today ? today : d)?.events.push(e)
  }
  for (const d of days) d.events.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))

  const overdue: PlanEntry[] = []
  const later: PlanEntry[] = []
  const undated: ScoredItem[] = []

  for (const s of ranked) {
    const due = s.item.dueDate
    if (!due) {
      undated.push(s)
      continue
    }
    if (due < today) {
      overdue.push({ s, note: `Vencía ${dueLabel(today, due)}` })
      continue
    }
    const start = addDays(due, -Math.max(0, s.item.prepDays))
    const action = start < today ? today : start
    const note = action === due ? null : `${action === today ? 'Empieza ya' : 'Empezar'} · vence ${dueLabel(today, due)}`
    if (action > last) later.push({ s, note: `Vence ${dueLabel(today, due)}` })
    else byDay.get(action)!.entries.push({ s, note })
  }

  later.sort((a, b) => a.s.item.dueDate!.localeCompare(b.s.item.dueDate!))
  return { overdue, days, later, undated }
}
