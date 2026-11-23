import { describe, expect, it } from 'vitest'
import { toCalendarEvents } from '../src/main/calendar'

describe('toCalendarEvents', () => {
  it('convierte reuniones con zona horaria y días completos', () => {
    const out = toCalendarEvents(
      [
        { id: 'b', title: 'Comité', start: '2026-11-24T10:00:00+01:00', end: '2026-11-24T11:00:00+01:00', allDay: false, location: 'Sala 2', attendees: ['ana@x.com'], description: null },
        { id: 'a', title: 'Festivo', start: '2026-11-24', end: '2026-11-25', allDay: true, location: null, attendees: [], description: null },
        { id: 'c', title: 'Roto', start: 'no-es-fecha', end: '', allDay: false, location: null, attendees: [], description: null }
      ],
      'connector:claude.ai Google Calendar'
    )
    expect(out).toHaveLength(2)
    const comite = out.find((e) => e.title === 'Comité')!
    expect(comite.start).toBe('2026-11-24T09:00:00.000Z')
    expect(comite.allDay).toBe(false)
    const festivo = out.find((e) => e.title === 'Festivo')!
    expect(festivo.allDay).toBe(true)
    expect(new Date(festivo.end).getTime() - new Date(festivo.start).getTime()).toBe(86_400_000)
  })

  it('pone una hora de duración si falta el fin', () => {
    const [e] = toCalendarEvents([{ id: 'x', title: '', start: '2026-11-24T10:00:00Z', end: '', allDay: false, location: null, attendees: [], description: null }], 's')
    expect(e.title).toBe('(sin título)')
    expect(e.end).toBe('2026-11-24T11:00:00.000Z')
  })
})
