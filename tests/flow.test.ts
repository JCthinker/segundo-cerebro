import { describe, expect, it } from 'vitest'
import { fallbackWeekly, flowSignals, mergeFlow, nextMeeting } from '../src/shared/flow'
import type { JiraInitiative, JiraSnapshot } from '../src/shared/jira'

const ini = (p: Partial<JiraInitiative>): JiraInitiative => ({
  key: 'ROAD-1', title: 'Iniciativa', status: 'Backlog', quarter: null, url: null, developers: [], taskKeys: [], epicKey: null, updated: null, ...p
})
const snap = (initiatives: JiraInitiative[]): JiraSnapshot => ({ at: '2026-11-24T10:00:00Z', initiatives, tasks: [], epics: [] })
const now = new Date('2026-11-24T09:00:00Z')

describe('flowSignals', () => {
  it('sin copia de Jira no propone nada', () => {
    expect(flowSignals(null, [], now)).toEqual([])
  })

  it('pide tareas y épica para lo que está en Ready to dev', () => {
    const s = snap([ini({ key: 'ROAD-5', title: 'Pagos', status: 'Ready to dev' }), ini({ key: 'ROAD-6', status: 'Backlog' }), ini({ key: 'ROAD-7', status: 'Backlog' }), ini({ key: 'ROAD-8', status: 'Discovery', developers: ['Ana'] })])
    const keys = flowSignals(s, [], now).map((a) => a.key)
    expect(keys).toEqual(['tasks:ROAD-5', 'epic:ROAD-5'])
  })

  it('avisa del discovery sin desarrollador y de que el flujo se seca', () => {
    const s = snap([ini({ key: 'ROAD-2', status: 'Discovery' })])
    const titles = flowSignals(s, [], now).map((a) => a.kind)
    expect(titles).toEqual(['discovery', 'refine', 'backlog'])
  })

  it('menciona la próxima sprint planning', () => {
    const s = snap([ini({ key: 'ROAD-5', status: 'Ready to dev' }), ini({ key: 'ROAD-6' }), ini({ key: 'ROAD-7' }), ini({ key: 'ROAD-8', status: 'Discovery', developers: ['x'] })])
    const a = flowSignals(s, [{ title: 'Sprint Planning', start: '2026-11-26T09:00:00Z' }], now)
    expect(a[0].why).toMatch(/sprint planning es el/)
  })
})

describe('mergeFlow', () => {
  const signals = flowSignals(snap([ini({ key: 'ROAD-2', status: 'Discovery' })]), [], now)

  it('usa el orden de Claude y añade lo nuevo al final', () => {
    const m = mergeFlow(signals, [{ key: 'backlog:subir iniciativas al backlog', title: 'x', why: 'Primero esto' }], {}, '2026-11-24')
    expect(m[0].kind).toBe('backlog')
    expect(m[0].why).toBe('Primero esto')
    expect(m).toHaveLength(3)
  })

  it('quita lo que ya se arregló, pero no las ideas propias de Claude', () => {
    const m = mergeFlow([], [{ key: 'tasks:ROAD-9', title: 'x', why: '' }, { key: 'ai:medir', title: 'Medir pagos', why: 'Toca' }], {}, '2026-11-24')
    expect(m.map((a) => a.key)).toEqual(['ai:medir'])
  })

  it('oculta lo marcado hasta su fecha', () => {
    const k = signals[0].key
    expect(mergeFlow(signals, undefined, { [k]: '2026-11-25' }, '2026-11-24').some((a) => a.key === k)).toBe(false)
    expect(mergeFlow(signals, undefined, { [k]: '2026-11-25' }, '2026-11-25').some((a) => a.key === k)).toBe(true)
  })
})

describe('utilidades del flujo', () => {
  it('nextMeeting busca la próxima que encaje', () => {
    const ev = [{ title: 'Grooming', start: '2026-11-20T09:00:00Z' }, { title: 'Grooming', start: '2026-11-27T09:00:00Z' }]
    expect(nextMeeting(ev, /grooming/i, now)?.start).toBe('2026-11-27T09:00:00Z')
  })
  it('fallbackWeekly dice si Jira está al día', () => {
    expect(fallbackWeekly([], [], now)).toMatch(/al día/)
  })
})
