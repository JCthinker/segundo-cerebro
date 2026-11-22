import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseIcs } from '../src/main/calendar'

const ics = readFileSync(resolve(__dirname, 'fixtures/ejemplo.ics'), 'utf8')

describe('parseIcs', () => {
  const events = parseIcs(ics, 'cal', new Date('2026-11-22T00:00:00Z'), new Date('2026-11-29T00:00:00Z'))

  it('lee eventos simples con asistentes', () => {
    const demo = events.find((e) => e.title === 'Demo con el cliente X')
    expect(demo).toBeDefined()
    expect(demo!.start).toBe('2026-11-22T15:00:00.000Z')
    expect(demo!.attendees).toEqual(['Marta', 'Luis'])
    expect(demo!.location).toBe('Sala 2')
  })

  it('expande los recurrentes dentro del rango', () => {
    const standups = events.filter((e) => e.title === 'Standup')
    expect(standups.map((e) => e.start.slice(0, 10))).toEqual(['2026-11-23', '2026-11-25', '2026-11-27'])
  })

  it('ignora cancelados y fuera de rango, y ordena por inicio', () => {
    expect(events.find((e) => e.title === 'Cancelada')).toBeUndefined()
    expect(events.find((e) => e.title === 'Fuera de rango')).toBeUndefined()
    const starts = events.map((e) => e.start)
    expect([...starts].sort()).toEqual(starts)
  })
})
