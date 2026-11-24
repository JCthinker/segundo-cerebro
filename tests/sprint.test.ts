import { describe, expect, it } from 'vitest'
import { sprintGoal, sprintRows } from '../src/shared/sprint'
import type { JiraInitiative, JiraSnapshot, JiraTask } from '../src/shared/jira'

const ini = (p: Partial<JiraInitiative>): JiraInitiative => ({
  key: 'ROAD-1', title: 'Pagos', status: 'Ready to dev', quarter: 'Q4 - 2026', url: null, developers: [], taskKeys: [], epicKey: null, updated: null, ...p
})
const task = (p: Partial<JiraTask>): JiraTask => ({ key: 'FP-1', title: 'T', status: 'To Do', url: null, hasDescription: true, estimated: true, epicKey: null, sprint: null, ...p })
const now = new Date(2026, 10, 24)

describe('sprintRows', () => {
  it('compara las tareas de la iniciativa con las de su épica', () => {
    const snap: JiraSnapshot = {
      at: '', initiatives: [ini({ taskKeys: ['FP-1', 'FP-2'] })],
      tasks: [task({ key: 'FP-1' }), task({ key: 'FP-2', estimated: false }), task({ key: 'FP-3' })],
      epics: [{ key: 'FP-9', title: 'Épica', url: null, roadKey: 'ROAD-1', taskKeys: ['FP-1', 'FP-3'] }]
    }
    const [r] = sprintRows(snap, now)
    expect(r.epic).toEqual({ key: 'FP-9', url: null, missing: ['FP-2'], extra: ['FP-3'] })
    expect(r.problems).toEqual(['1 FP sin describir o estimar', 'Faltan en la épica: FP-2', 'Sobran en la épica: FP-3'])
    expect(r.ready).toBe(false)
  })

  it('una iniciativa con todo en orden está lista', () => {
    const snap: JiraSnapshot = { at: '', initiatives: [ini({ taskKeys: ['FP-1'], epicKey: 'FP-9' })], tasks: [task({})], epics: [{ key: 'FP-9', title: 'E', url: null, roadKey: null, taskKeys: ['fp-1'] }] }
    const rows = sprintRows(snap, now)
    expect(rows[0].ready).toBe(true)
    expect(sprintGoal(rows)).toMatch(/Objetivo posible: avanzar «Pagos»/)
  })

  it('sin iniciativas listas lo dice', () => {
    expect(sprintGoal([])).toMatch(/No hay iniciativas/)
  })
})
