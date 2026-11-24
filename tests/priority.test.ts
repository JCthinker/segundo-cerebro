import { describe, expect, it } from 'vitest'
import { letGoCandidates, rankItems, scoreItem } from '@shared/priority'
import type { Area, Item } from '@shared/types'

const TODAY = '2026-11-22'
const areas: Area[] = [
  { id: 'cliente', name: 'Cliente X', weight: 1.5 },
  { id: 'personal', name: 'Personal', weight: 1 },
  { id: 'admin', name: 'Admin', weight: 0.5 }
]

function item(p: Partial<Item>): Item {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    kind: 'task',
    title: 't',
    person: null,
    dueDate: null,
    prepDays: 0,
    areaId: null,
    status: 'active',
    sourceType: 'manual',
    sourceRef: null,
    sourceSnippet: null,
    createdAt: TODAY,
    updatedAt: TODAY,
    doneAt: null,
    ...p
  }
}

describe('scoreItem', () => {
  it('una promesa a otra persona pesa más que una tarea propia con la misma fecha', () => {
    const p = scoreItem(item({ kind: 'promise', person: 'Ana', dueDate: '2026-11-25' }), TODAY, areas)
    const t = scoreItem(item({ kind: 'task', dueDate: '2026-11-25' }), TODAY, areas)
    expect(p.score).toBeGreaterThan(t.score)
    expect(p.reasons).toContain('Encargo de Ana')
  })

  it('marca "vence mañana" y en riesgo para promesas', () => {
    const s = scoreItem(item({ kind: 'promise', person: 'Ana', dueDate: '2026-11-23' }), TODAY, areas)
    expect(s.reasons).toContain('Vence mañana')
    expect(s.atRisk).toBe(true)
    expect(s.daysToDue).toBe(1)
  })

  it('las atrasadas suben del todo', () => {
    const s = scoreItem(item({ kind: 'task', dueDate: '2026-11-19' }), TODAY, areas)
    expect(s.reasons).toContain('Atrasada 3 días')
    expect(s.score).toBeGreaterThanOrEqual(55)
  })

  it('el margen de preparación adelanta la urgencia', () => {
    const sinMargen = scoreItem(item({ kind: 'deadline', dueDate: '2026-11-30', prepDays: 0 }), TODAY, areas)
    const conMargen = scoreItem(item({ kind: 'deadline', dueDate: '2026-11-30', prepDays: 8 }), TODAY, areas)
    expect(conMargen.score).toBeGreaterThan(sinMargen.score)
    expect(conMargen.reasons.join(' ')).toMatch(/empezar ya/)
  })

  it('el peso del área multiplica y se explica', () => {
    const base = scoreItem(item({ kind: 'deadline', dueDate: '2026-11-26' }), TODAY, areas)
    const cliente = scoreItem(item({ kind: 'deadline', dueDate: '2026-11-26', areaId: 'cliente' }), TODAY, areas)
    expect(cliente.score).toBeCloseTo(base.score * 1.5, 1)
    expect(cliente.reasons).toContain('Área Cliente X (×1,5)')
    const admin = scoreItem(item({ kind: 'deadline', dueDate: '2026-11-26', areaId: 'admin' }), TODAY, areas)
    expect(admin.score).toBeLessThan(base.score)
  })

  it('sin fecha no suma urgencia', () => {
    const s = scoreItem(item({ kind: 'task' }), TODAY, areas)
    expect(s.score).toBe(5)
    expect(s.daysToDue).toBeNull()
  })
})

describe('rankItems', () => {
  it('ordena, descarta decisiones y lo que no está activo', () => {
    const ranked = rankItems(
      [
        item({ id: 'lejos', kind: 'task', dueDate: '2026-12-20' }),
        item({ id: 'ana', kind: 'promise', person: 'Ana', dueDate: '2026-11-23' }),
        item({ id: 'hecha', kind: 'promise', status: 'done', dueDate: '2026-11-22' }),
        item({ id: 'propuesta', kind: 'promise', status: 'proposed', dueDate: '2026-11-22' }),
        item({ id: 'decision', kind: 'decision' }),
        item({ id: 'entrega', kind: 'deadline', dueDate: '2026-11-30', prepDays: 8, areaId: 'cliente' })
      ],
      TODAY,
      areas
    )
    expect(ranked.map((r) => r.item.id)).toEqual(['entrega', 'ana', 'lejos'])
  })

  it('propone soltar tareas lejanas y nunca promesas', () => {
    const ranked = rankItems(
      [
        item({ id: 'a', kind: 'promise', person: 'Ana', dueDate: '2026-11-23' }),
        item({ id: 'b', kind: 'deadline', dueDate: '2026-11-24' }),
        item({ id: 'c', kind: 'task', dueDate: '2026-11-22' }),
        item({ id: 'd', kind: 'task', dueDate: '2026-12-15' }),
        item({ id: 'e', kind: 'promise', person: 'Luis', dueDate: '2026-12-30' }),
        item({ id: 'f', kind: 'task' })
      ],
      TODAY,
      areas
    )
    const ids = letGoCandidates(ranked).map((s) => s.item.id)
    expect(ids).toContain('f')
    expect(ids).toContain('d')
    expect(ids).not.toContain('e')
  })
})
