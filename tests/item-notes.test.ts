import { describe, expect, it } from 'vitest'
import { cleanNoteText, noteWhen, notesForPrompt } from '../src/shared/item-notes'

describe('cleanNoteText', () => {
  it('no guarda notas vacías', () => {
    expect(cleanNoteText('   \n ')).toBeNull()
  })
  it('quita espacios sobrantes y líneas en blanco de más', () => {
    expect(cleanNoteText('  hola\n\n\n\nadiós  ')).toBe('hola\n\nadiós')
  })
})

describe('noteWhen', () => {
  const now = new Date(2026, 10, 25, 12, 0)
  it('dice hoy y ayer', () => {
    expect(noteWhen(new Date(2026, 10, 25, 9, 5).toISOString(), now)).toMatch(/^hoy 09:05$/)
    expect(noteWhen(new Date(2026, 10, 24, 18, 30).toISOString(), now)).toMatch(/^ayer 18:30$/)
  })
  it('pone la fecha si es más antigua', () => {
    expect(noteWhen(new Date(2026, 10, 3, 8, 0).toISOString(), now)).toContain('3')
    expect(noteWhen(new Date(2025, 0, 3, 8, 0).toISOString(), now)).toContain('2025')
  })
})

describe('notesForPrompt', () => {
  it('no añade nada si no hay notas', () => {
    expect(notesForPrompt([])).toBe('')
  })
  it('lista las notas en una línea cada una', () => {
    const now = new Date(2026, 10, 25, 12, 0)
    const txt = notesForPrompt([{ id: '1', itemId: 'i', text: 'Hablado con Ana\nmañana', createdAt: new Date(2026, 10, 25, 10, 0).toISOString() }], now)
    expect(txt).toContain('Notas que ha ido añadiendo')
    expect(txt).toContain('(hoy 10:00) Hablado con Ana mañana')
  })
})
