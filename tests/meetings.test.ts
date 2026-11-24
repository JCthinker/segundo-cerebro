import { describe, expect, it } from 'vitest'
import { meetingType, prepFromJira } from '../src/shared/meetings'
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
