import { describe, expect, it, vi } from 'vitest'

// appendToSection es pura, pero el módulo importa la base de datos y el SDK: los simulamos.
vi.mock('../src/main/db', () => ({}))
vi.mock('../src/main/agent/client', () => ({}))
vi.mock('../src/main/agent/context', () => ({}))

const { appendToSection } = await import('../src/main/agent/suggest-rules')

const MD = `# Cómo trabajo

## Reglas
- Nada antes de las 10.

## Permisos
- jira: automático
`

describe('appendToSection', () => {
  it('añade al final de la sección existente', () => {
    const out = appendToSection(MD, 'Reglas', 'Lo de Marta, en 48 horas')
    expect(out).toContain('- Nada antes de las 10.\n- Lo de Marta, en 48 horas\n\n## Permisos')
  })

  it('crea la sección si no existe', () => {
    const out = appendToSection(MD, 'Rituales', '- Viernes: cierre semanal')
    expect(out.trimEnd().endsWith('## Rituales\n- Viernes: cierre semanal')).toBe(true)
  })
})
