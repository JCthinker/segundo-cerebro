import { describe, expect, it } from 'vitest'
import { deleteNoteQuestion } from '../src/shared/notes'

describe('deleteNoteQuestion', () => {
  it('pregunta aunque la nota no tenga nada dentro', () => {
    expect(deleteNoteQuestion('Ideas', 0)).toBe('¿Borrar «Ideas»? No se puede deshacer.')
  })

  it('nombra las notas sin título', () => {
    expect(deleteNoteQuestion('  ', 0)).toBe('¿Borrar esta nota sin título? No se puede deshacer.')
  })

  it('avisa de las notas que tiene dentro', () => {
    expect(deleteNoteQuestion('Proyecto', 1)).toContain('También se borrarán la nota que tiene dentro.')
    expect(deleteNoteQuestion('Proyecto', 3)).toContain('También se borrarán las 3 notas que tiene dentro.')
  })
})
