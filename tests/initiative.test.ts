import { describe, expect, it } from 'vitest'
import { nextStepFor, stagePath } from '../src/shared/initiative'
import type { JiraInitiative, JiraSnapshot } from '../src/shared/jira'

const ini = (p: Partial<JiraInitiative>): JiraInitiative => ({
  key: 'ROAD-1', title: 'Pagos', status: 'Backlog', quarter: null, url: null, developers: [], taskKeys: [], epicKey: null, updated: null, ...p
})
const snap: JiraSnapshot = { at: '', initiatives: [], tasks: [], epics: [] }
const now = new Date(2026, 10, 24)

describe('stagePath', () => {
  it('marca los pasos hechos, el actual y los siguientes', () => {
    const p = stagePath('Ready to refine')
    expect(p.map((s) => s.state)).toEqual(['done', 'done', 'current', 'next', 'next', 'next'])
    expect(p[0].id).toBe('backlog')
  })
  it('enseña Backlog 2 solo si está ahí', () => {
    expect(stagePath('Backlog 2')[0]).toMatchObject({ id: 'backlog2', state: 'current' })
  })
})

describe('nextStepFor', () => {
  it('en Backlog pide el KPI si no lo tiene', () => {
    expect(nextStepFor(ini({}), snap, now)).toMatch(/apunta su KPI/)
    expect(nextStepFor(ini({ kpi: 'Conversión' }), snap, now)).toMatch(/«Conversión»/)
  })
  it('en Discovery sin desarrollador pide buscarlo', () => {
    expect(nextStepFor(ini({ status: 'Discovery' }), snap, now)).toMatch(/Buscar un desarrollador/)
  })
  it('en Ready to dev dice qué le falta', () => {
    expect(nextStepFor(ini({ status: 'Ready to dev' }), snap, now)).toMatch(/no tiene tareas FP; no tiene épica/)
  })
})
