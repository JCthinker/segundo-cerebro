import { describe, expect, it } from 'vitest'
import { onlyNew, sameTask, ticketKeys, toolFromRef } from '../src/shared/dedupe'

describe('sameTask', () => {
  it('reconoce la misma tarea dicha con otras palabras', () => {
    expect(sameTask({ title: 'Preparar la propuesta visual de pagos' }, { title: 'Propuesta visual: pagos, preparar' })).toBe(true)
    expect(sameTask({ title: 'Mandar el informe a Ana' }, { title: 'Enviar informe a Ana' })).toBe(true)
    expect(sameTask({ title: 'Revisar FP-123' }, { title: 'Comprobar FP-123' })).toBe(true)
  })

  it('permite varias tareas distintas sobre el mismo asunto o ticket', () => {
    expect(sameTask({ title: 'Estimar FP-123' }, { title: 'Describir FP-123' })).toBe(false)
    expect(sameTask({ title: 'Invitar a un desarrollador al discovery de pagos' }, { title: 'Preparar la propuesta visual de pagos' })).toBe(false)
  })

  it('no junta tareas para personas o tickets distintos', () => {
    expect(sameTask({ title: 'Enviar el informe a Ana' }, { title: 'Enviar el informe a Luis' })).toBe(false)
    expect(sameTask({ title: 'Revisar FP-123' }, { title: 'Revisar FP-124' })).toBe(false)
  })
})

describe('onlyNew', () => {
  it('la misma tarea vista en varios canales sale una vez', () => {
    const fromChannels = ['#producto', '#dev', '#soporte', 'correo', 'Jira'].map((c) => ({
      title: 'Llevar a Jira el bloqueo del login con SSO',
      sourceRef: c
    }))
    expect(onlyNew(fromChannels, [])).toHaveLength(1)
  })

  it('no vuelve a proponer lo que ya existe o se descartó, y no tiene límite', () => {
    const existing = [{ title: 'Crear la tarea FP del buscador' }]
    const nuevas = ['alfa', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'theta'].map((w) => ({ title: `Tarea ${w} distinta` }))
    const out = onlyNew([{ title: 'Crear tarea FP buscador' }, ...nuevas], existing)
    expect(out).toHaveLength(7)
    expect(out.map((x) => x.title)).not.toContain('Crear tarea FP buscador')
  })

  it('repetir el repaso no crea nada nuevo', () => {
    const primera = onlyNew([{ title: 'Invitar a Pablo al discovery' }, { title: 'Crear FP-12 tras el refinement' }], [])
    expect(onlyNew([{ title: 'Invitar a Pablo al discovery' }, { title: 'Crear FP-12 tras el refinement' }], primera)).toHaveLength(0)
  })
})

describe('ticketKeys y toolFromRef', () => {
  it('saca las claves de Jira', () => {
    expect(ticketKeys('Ver ROAD-45 y FP-7, y otra vez FP-7')).toEqual(['ROAD-45', 'FP-7'])
  })

  it('deduce la herramienta del enlace', () => {
    expect(toolFromRef('https://mail.google.com/mail/u/0/#all/abc')).toBe('Gmail')
    expect(toolFromRef('https://miempresa.slack.com/archives/C1/p2')).toBe('Slack')
    expect(toolFromRef('https://miempresa.atlassian.net/browse/FP-1')).toBe('Jira')
    expect(toolFromRef('Repaso de la mañana')).toBeNull()
  })
})
