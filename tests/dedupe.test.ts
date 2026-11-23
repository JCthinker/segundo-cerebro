import { describe, expect, it } from 'vitest'
import { onlyNew, sameTopic, ticketKeys } from '../src/shared/dedupe'

describe('sameTopic', () => {
  it('reconoce el mismo ticket aunque el título cambie', () => {
    expect(sameTopic({ title: 'Revisar FP-123 antes de la planning' }, { title: 'Completar la descripción', sourceRef: 'https://jira/browse/FP-123' })).toBe(true)
  })

  it('reconoce el mismo asunto redactado distinto', () => {
    expect(sameTopic({ title: 'Preparar la propuesta visual de pagos' }, { title: 'Propuesta visual: pagos' })).toBe(true)
    expect(sameTopic({ title: 'Invitar a un desarrollador al discovery de onboarding' }, { title: 'Invitar desarrollador discovery onboarding' })).toBe(true)
  })

  it('no junta asuntos distintos', () => {
    expect(sameTopic({ title: 'Enviar el informe a Ana' }, { title: 'Enviar el informe a Luis' })).toBe(false)
    expect(sameTopic({ title: 'Revisar FP-123' }, { title: 'Revisar FP-124' })).toBe(false)
    expect(sameTopic({ title: 'Propuesta visual de pagos' }, { title: 'Propuesta visual de facturas' })).toBe(false)
  })
})

describe('onlyNew', () => {
  const existing = [{ title: 'Crear la tarea FP del buscador', sourceSnippet: 'acordado en refinement' }]

  it('un mismo asunto en varios canales se queda en uno', () => {
    const fromChannels = ['#producto', '#dev', '#soporte', 'correo', 'Jira'].map((c) => ({
      title: 'Llevar a Jira el bloqueo del login con SSO',
      sourceRef: c
    }))
    expect(onlyNew(fromChannels, [])).toHaveLength(1)
  })

  it('no vuelve a proponer lo que ya existe o se descartó', () => {
    expect(onlyNew([{ title: 'Crear tarea FP buscador' }, { title: 'Invitar a Pablo al discovery' }], existing).map((x) => x.title)).toEqual([
      'Invitar a Pablo al discovery'
    ])
  })

  it('respeta el máximo', () => {
    const many = ['alfa', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'theta'].map((w) => ({ title: `Tarea ${w} distinta` }))
    expect(onlyNew(many, [], 5)).toHaveLength(5)
  })
})

describe('ticketKeys', () => {
  it('saca las claves de Jira', () => {
    expect(ticketKeys('Ver ROAD-45 y FP-7, y otra vez FP-7')).toEqual(['ROAD-45', 'FP-7'])
  })
})
