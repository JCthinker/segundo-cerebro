import { describe, expect, it } from 'vitest'
import { isNewer } from '../src/shared/version'

describe('isNewer', () => {
  it('compara números, no texto', () => {
    expect(isNewer('0.1.10', '0.1.9')).toBe(true)
    expect(isNewer('v0.2.0', '0.1.9')).toBe(true)
    expect(isNewer('0.1.9', '0.1.9')).toBe(false)
    expect(isNewer('0.1.8', '0.1.9')).toBe(false)
  })
})
