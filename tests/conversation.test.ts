import { describe, expect, it } from 'vitest'
import { buildGoal, isGoAhead } from '../src/shared/conversation'

describe('isGoAhead', () => {
  it('reconoce un «sí, adelante» dicho de muchas formas', () => {
    for (const t of ['sí', 'Sí, hazlo', 'vale', 'OK!', 'adelante', 'Dale', 'perfecto, adelante', 'me parece bien', 'sí, por favor', 'Ejecútalo', 'de acuerdo'])
      expect(isGoAhead(t), t).toBe(true)
  })

  it('no confunde un cambio o una respuesta con un sí', () => {
    for (const t of ['', 'no', 'sí, pero mándalo por Slack', 'mejor por correo', 'los comentarios están en la nota de ayer', 'no lo hagas'])
      expect(isGoAhead(t), t).toBe(false)
  })
})

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
