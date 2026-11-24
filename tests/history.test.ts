import { describe, expect, it } from 'vitest'
import { buildHistory, requestTitle } from '../src/shared/history'
import type { ActionRun, Item } from '../src/shared/types'

const item = (p: Partial<Item>): Item => ({
  id: 'i', kind: 'task', title: 'Tarea', person: null, dueDate: null, prepDays: 0, areaId: null, status: 'active',
  sourceType: 'manual', sourceRef: null, sourceSnippet: null, createdAt: '2026-11-20T08:00:00Z', updatedAt: '2026-11-20T08:00:00Z', doneAt: null, ...p
})
const run = (p: Partial<ActionRun>): ActionRun => ({
  id: 'r', itemId: null, goal: 'Encargo', mode: 'normal', status: 'done', log: [], createdAt: '2026-11-22T09:00:00Z', ...p
})

describe('buildHistory', () => {
  it('junta lo hecho, lo descartado y lo de Claude, por días y lo más reciente primero', () => {
    const days = buildHistory(
      [
        item({ id: 'a', title: 'Hecha', status: 'done', doneAt: '2026-11-23T10:00:00Z' }),
        item({ id: 'b', title: 'Fuera', status: 'dismissed', dismissReason: 'no es mío', updatedAt: '2026-11-22T11:00:00Z' }),
        item({ id: 'c', title: 'Pendiente', status: 'active' })
      ],
      [run({ id: 'r1', log: [{ at: '2026-11-22T09:05:00Z', type: 'result', text: 'Enviado' }] })]
    )
    expect(days.map((d) => d.date)).toEqual(['2026-11-23', '2026-11-22'])
    expect(days[0].entries.map((e) => e.kind)).toEqual(['done'])
    expect(days[1].entries.map((e) => [e.kind, e.detail])).toEqual([
      ['dismissed', 'no es mío'],
      ['claude', 'Enviado']
    ])
  })

  it('lo que solo tiene plan sale como «pedido, sin lanzar» con sus pasos', () => {
    const [day] = buildHistory([], [
      run({ status: 'planned', log: [{ at: '2026-11-22T09:01:00Z', type: 'plan', text: 'Escribir a Ana', steps: ['Leer hilo', 'Enviar correo'] }] })
    ])
    expect(day.entries).toHaveLength(1)
    expect(day.entries[0]).toMatchObject({ kind: 'planned', detail: 'Escribir a Ana', steps: ['Leer hilo', 'Enviar correo'] })
  })

  it('cada acción que rechazas queda aparte; las prohibidas por regla no', () => {
    const [day] = buildHistory([], [
      run({
        log: [
          { at: '2026-11-22T09:02:00Z', type: 'denied', text: 'slack · send: rechazado por ti', toolName: 'mcp__slack__send', byUser: true },
          { at: '2026-11-22T09:03:00Z', type: 'denied', text: 'jira · delete: prohibido (regla)', toolName: 'mcp__jira__delete' },
          { at: '2026-11-22T09:04:00Z', type: 'draft', text: 'gmail: borrador' },
          { at: '2026-11-22T09:05:00Z', type: 'result', text: 'Listo' }
        ]
      })
    ])
    expect(day.entries.map((e) => e.kind)).toEqual(['claude', 'rejected'])
    expect(day.entries[0].drafts).toBe(1)
    expect(day.entries[1].toolName).toBe('mcp__slack__send')
  })

  it('lo que falla o se detiene sale como no terminado', () => {
    const [day] = buildHistory([], [
      run({ id: 'x', status: 'error', log: [{ at: '2026-11-22T09:02:00Z', type: 'error', text: 'Sin conexión' }] }),
      run({ id: 'y', status: 'cancelled', createdAt: '2026-11-22T08:00:00Z' })
    ])
    expect(day.entries.map((e) => [e.kind, e.detail])).toEqual([
      ['failed', 'Sin conexión'],
      ['failed', 'Se detuvo antes de terminar.']
    ])
  })
})

describe('requestTitle', () => {
  it('usa lo primero que pediste, sin el texto que añade la app', () => {
    expect(requestTitle('Avisa a Marta')).toBe('Avisa a Marta')
    expect(requestTitle('Lo que te ha ido diciendo el usuario, en orden (si algo se contradice, manda lo último):\n- Avisa a Marta\n- por Slack')).toBe('Avisa a Marta')
    expect(requestTitle('')).toBe('Encargo a Claude')
  })
})
