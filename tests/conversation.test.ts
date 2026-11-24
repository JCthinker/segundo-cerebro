import { describe, expect, it } from 'vitest'
import { buildGoal } from '../src/shared/conversation'

describe('buildGoal', () => {
  it('sin mensajes queda vacío', () => {
    expect(buildGoal([])).toBe('')
    expect(buildGoal(['  ', ''])).toBe('')
  })

  it('un solo mensaje se pasa tal cual', () => {
    expect(buildGoal([' avísale por Slack '])).toBe('avísale por Slack')
  })

  it('varios mensajes van en orden y manda el último', () => {
    const g = buildGoal(['envíale el informe', 'mejor por correo'])
    expect(g).toContain('manda lo último')
    expect(g.indexOf('envíale el informe')).toBeLessThan(g.indexOf('mejor por correo'))
  })

  it('añade lo que ya se hizo para no repetirlo', () => {
    const g = buildGoal(['y ahora apúntalo en Jira'], 'Envié el correo a Ana.')
    expect(g).toContain('y ahora apúntalo en Jira')
    expect(g).toContain('Envié el correo a Ana.')
    expect(buildGoal([], 'Hecho')).toMatch(/^Lo que ya hiciste/)
  })
})
