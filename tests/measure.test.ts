import { describe, expect, it } from 'vitest'
import { measureRows } from '../src/shared/measure'
import type { JiraInitiative, JiraSnapshot } from '../src/shared/jira'

const ini = (p: Partial<JiraInitiative>): JiraInitiative => ({
  key: 'ROAD-1', title: 'Pagos', status: 'Done', quarter: null, url: null, developers: [], taskKeys: [], epicKey: null, updated: '2026-11-01T10:00:00Z', ...p
})
const snap = (initiatives: JiraInitiative[]): JiraSnapshot => ({ at: '', initiatives, tasks: [], epics: [] })

describe('measureRows', () => {
  it('propone medir a las dos semanas y avisa cuando toca', () => {
    const [r] = measureRows(snap([ini({})]), {}, {}, '2026-11-24')
    expect(r.plan.date).toBe('2026-11-15')
    expect(r.due).toBe(true)
  })
  it('respeta la fecha de Claude y lo ya medido', () => {
    const rows = measureRows(
      snap([ini({ key: 'ROAD-1' }), ini({ key: 'ROAD-2' })]),
      { 'ROAD-1': { date: '2026-12-15', kpi: 'Conversión', why: 'Hace falta un mes de datos', byAI: true } },
      { 'ROAD-2': { at: '2026-11-20', text: 'Subió un 3 %' } },
      '2026-11-24'
    )
    expect(rows.map((r) => [r.key, r.due])).toEqual([['ROAD-1', false], ['ROAD-2', false]])
  })
  it('ignora lo que no está terminado o es muy antiguo', () => {
    expect(measureRows(snap([ini({ status: 'WIP' }), ini({ updated: '2026-01-01T00:00:00Z' })]), {}, {}, '2026-11-24')).toEqual([])
  })
})
