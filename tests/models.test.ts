import { describe, expect, it } from 'vitest'
import { DEFAULT_QUICK_MODEL, DEFAULT_STRONG_MODEL, modelFor } from '@shared/models'

describe('modelFor', () => {
  it('usa el modelo barato para decidir y el potente para resolver', () => {
    const s = { model: 'claude-opus-5-5', quickModel: 'claude-haiku-5-5' }
    expect(modelFor('quick', s)).toBe('claude-haiku-5-5')
    expect(modelFor('strong', s)).toBe('claude-opus-5-5')
  })
  it('si falta alguno, usa el de por defecto', () => {
    const s = { model: '', quickModel: '' }
    expect(modelFor('quick', s)).toBe(DEFAULT_QUICK_MODEL)
    expect(modelFor('strong', s)).toBe(DEFAULT_STRONG_MODEL)
  })
})
