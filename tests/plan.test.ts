import { describe, expect, it } from 'vitest'
import { planDays } from '@shared/plan'
import { rankItems } from '@shared/priority'
import type { CalendarEvent, Item } from '@shared/types'

const TODAY = '2026-11-22'

function item(p: Partial<Item>): Item {
  return {
    id: p.id ?? Math.random().toString(36).slice(2), kind: 'task', title: 't', person: null, dueDate: null, prepDays: 0,
    areaId: null, status: 'active', sourceType: 'manual', sourceRef: null, sourceSnippet: null,
    createdAt: TODAY, updatedAt: TODAY, doneAt: null, ...p
  }
}
const ev = (id: string, start: string, allDay = false): CalendarEvent => ({
  id, sourceId: 's', title: id, start, end: start, allDay, location: null, attendees: [], description: null
})

describe('planDays', () => {
  const ranked = rankItems(
    [
      item({ id: 'atrasada', dueDate: '2026-11-20' }),
      item({ id: 'hoy', dueDate: '2026-11-22' }),
      item({ id: 'jueves', dueDate: '2026-11-26' }),
      item({ id: 'prep-empieza-ya', dueDate: '2026-11-25', prepDays: 5 }),
      item({ id: 'prep-empieza-martes', dueDate: '2026-12-02', prepDays: 8 }),
      item({ id: 'lejos', dueDate: '2027-01-10' }),
      item({ id: 'sin-fecha' })
    ],
    TODAY,
    []
  )
  const plan = planDays(ranked, [ev('reunion-manana', '2026-11-23T09:00:00'), ev('festivo', '2026-11-24', true)], TODAY)
  const day = (id: string) => plan.days.find((d) => d.entries.some((e) => e.s.item.id === id))?.day

  it('cubre 7 días desde hoy', () => {
    expect(plan.days.map((d) => d.day)).toEqual(['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'])
  })
  it('coloca cada cosa el día en que hay que empezar', () => {
    expect(day('hoy')).toBe(TODAY)
    expect(day('jueves')).toBe('2026-11-26')
    expect(day('prep-empieza-ya')).toBe(TODAY)
    expect(day('prep-empieza-martes')).toBe('2026-11-24')
  })
  it('explica cuándo vence si se empieza antes', () => {
    const e = plan.days[0].entries.find((x) => x.s.item.id === 'prep-empieza-ya')!
    expect(e.note).toMatch(/^Empieza ya · vence el /)
    expect(plan.days[0].entries.find((x) => x.s.item.id === 'hoy')!.note).toBeNull()
  })
  it('separa lo atrasado, lo lejano y lo que no tiene fecha', () => {
    expect(plan.overdue.map((e) => e.s.item.id)).toEqual(['atrasada'])
    expect(plan.later.map((e) => e.s.item.id)).toEqual(['lejos'])
    expect(plan.undated.map((s) => s.item.id)).toEqual(['sin-fecha'])
  })
  it('pone las reuniones en su día', () => {
    expect(plan.days[1].events.map((e) => e.id)).toEqual(['reunion-manana'])
    expect(plan.days[2].events.map((e) => e.id)).toEqual(['festivo'])
  })
})

import { defaultDueDate } from '@shared/dates'
describe('fecha por defecto', () => {
  it('lo que llega sin fecha vence mañana', () => {
    expect(defaultDueDate('task', null, '2026-11-23')).toBe('2026-11-24')
    expect(defaultDueDate('promise', undefined, '2026-11-30')).toBe('2026-12-01')
  })
  it('respeta la fecha que ya tiene y no pone fecha a las decisiones', () => {
    expect(defaultDueDate('task', '2026-12-05', '2026-11-23')).toBe('2026-12-05')
    expect(defaultDueDate('decision', null, '2026-11-23')).toBeNull()
  })
})
