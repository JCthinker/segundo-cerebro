import { describe, expect, it } from 'vitest'
import { meetingType, prepFromJira, tasksByMeeting } from '../src/shared/meetings'
import type { JiraInitiative, JiraSnapshot } from '../src/shared/jira'

const ini = (p: Partial<JiraInitiative>): JiraInitiative => ({
  key: 'ROAD-1', title: 'Iniciativa', status: 'Backlog', quarter: null, url: null, developers: [], taskKeys: [], epicKey: null, updated: null, ...p
})
const snap = (initiatives: JiraInitiative[]): JiraSnapshot => ({ at: '2026-11-24T10:00:00Z', initiatives, tasks: [], epics: [] })
const now = new Date('2026-11-24T09:00:00Z')

describe('meetingType', () => {
  it('reconoce los tipos por el título', () => {
    expect(meetingType('Grooming equipo pagos')).toBe('grooming')
    expect(meetingType('Sprint Planning')).toBe('planning')
    expect(meetingType('Planificación sprint 42')).toBe('planning')
    expect(meetingType('Discovery: alta de comercios')).toBe('discovery')
    expect(meetingType('Daily')).toBe('daily')
    expect(meetingType('Café con Marta')).toBe('other')
  })
})

describe('prepFromJira', () => {
  it('en el grooming separa soluciones para decidir y problemas nuevos', () => {
    const s = snap([ini({ key: 'ROAD-2', status: 'Ready to refine', developers: ['Ana'] }), ini({ key: 'ROAD-3', status: 'Backlog' })])
    const p = prepFromJira('grooming', s, now)
    expect(p[0]).toMatch(/^Solución para decidir · ROAD-2.*con Ana/)
    expect(p[1]).toMatch(/^Problema nuevo · ROAD-3.*KPI/)
  })

  it('en la sprint planning dice qué falta a cada iniciativa', () => {
    const p = prepFromJira('planning', snap([ini({ key: 'ROAD-5', status: 'Ready to dev' })]), now)
    expect(p[0]).toMatch(/ROAD-5.*sin tareas fp/)
    expect(p.at(-1)).toMatch(/Objetivo de la sprint/)
  })

  it('no propone nada para otras reuniones o sin Jira', () => {
    expect(prepFromJira('other', snap([ini({})]), now)).toEqual([])
    expect(prepFromJira('grooming', null, now)).toEqual([])
  })
})

describe('tasksByMeeting', () => {
  const now2 = new Date('2026-11-25T08:00:00')
  const ev = (id: string, title: string, day: string, attendees: string[] = []) => ({
    id, sourceId: 's', title, start: `${day}T10:00:00`, end: `${day}T11:00:00`, allDay: false, location: null, attendees, description: null
  })
  const task = (id: string, title: string, dueDate: string | null = null, person: string | null = null) => ({ id, title, context: null, person, dueDate })
  const events = [ev('g', 'Grooming equipo pagos', '2026-11-27'), ev('a', '1:1 Ana', '2026-11-26', ['ana.lopez@empresa.com', 'yo@empresa.com']), ev('s', 'Sync pricing', '2026-11-25', ['Marta', 'Pablo', 'Luis', 'Eva', 'Raúl'])]

  it('pone debajo de la reunión las tareas que hablan de ella', () => {
    const m = tasksByMeeting(
      [task('1', 'Llevar la propuesta visual al grooming'), task('2', 'Comentar con Ana el cambio de precio'), task('3', 'Preparar números para el sync de pricing'), task('4', 'Contestar a Marta el correo')],
      events,
      now2
    )
    expect(m.get('g')).toEqual(['1'])
    expect(m.get('a')).toEqual(['2'])
    expect(m.get('s')).toEqual(['3'])
    expect([...m.values()].flat()).not.toContain('4')
  })

  it('no la mueve a una reunión posterior a su fecha límite', () => {
    const m = tasksByMeeting([task('1', 'Llevar la propuesta al grooming', '2026-11-26')], events, now2)
    expect(m.size).toBe(0)
  })

  it('no confunde trabajo con reuniones: «review» o «discovery» sueltos', () => {
    const m = tasksByMeeting([task('1', 'Hacer review del PR'), task('2', 'Hacer discovery de ROAD-12')], [ev('r', 'Sprint review', '2026-11-26'), ev('d', 'Discovery alta comercios', '2026-11-26')], now2)
    expect(m.size).toBe(0)
  })

  it('usa la persona de la tarea si va a una reunión pequeña con ella', () => {
    const m = tasksByMeeting([task('1', 'Preguntar por el presupuesto', null, 'Ana')], events, now2)
    expect(m.get('a')).toEqual(['1'])
  })
})
