import { describe, expect, it } from 'vitest'
import { decideToolMode, isReadOnlyTool, parsePermissions } from '@shared/permissions'

const FLOW = `# Cómo trabajo

## Reglas
- Nada de reuniones antes de las 10.

## Permisos
- jira: automático
- slack: requiere OK
- slack.send_message: solo borrador
- gmail: solo borrador
- *delete*: prohibido
- texto que no es regla

## Rituales
- jira: prohibido (esto no está en Permisos y no cuenta)
`

describe('parsePermissions', () => {
  it('solo lee la sección Permisos', () => {
    const rules = parsePermissions(FLOW)
    expect(rules).toEqual([
      { pattern: 'jira', mode: 'auto' },
      { pattern: 'slack', mode: 'ask' },
      { pattern: 'slack.send_message', mode: 'draft' },
      { pattern: 'gmail', mode: 'draft' },
      { pattern: '*delete*', mode: 'deny' }
    ])
  })
})

describe('isReadOnlyTool', () => {
  it('distingue lectura y escritura', () => {
    expect(isReadOnlyTool('mcp__jira__search_issues')).toBe(true)
    expect(isReadOnlyTool('mcp__slack__getChannelHistory')).toBe(true)
    expect(isReadOnlyTool('mcp__slack__send_message')).toBe(false)
    expect(isReadOnlyTool('mcp__jira__transition_issue')).toBe(false)
    expect(isReadOnlyTool('mcp__gmail__create_draft')).toBe(false)
    expect(isReadOnlyTool('mcp__x__do_thing')).toBe(false)
  })
})

describe('decideToolMode', () => {
  const rules = parsePermissions(FLOW)

  it('las herramientas internas son automáticas', () => {
    expect(decideToolMode('mcp__cerebro__update_item', rules).mode).toBe('auto')
  })

  it('aplica la regla por servidor', () => {
    expect(decideToolMode('mcp__jira__transition_issue', rules).mode).toBe('auto')
    expect(decideToolMode('mcp__slack__add_reaction', rules).mode).toBe('ask')
  })

  it('gana la regla más específica', () => {
    expect(decideToolMode('mcp__slack__send_message', rules).mode).toBe('draft')
  })

  it('los comodines funcionan', () => {
    expect(decideToolMode('mcp__jira__delete_issue', rules).mode).toBe('deny')
  })

  it('por defecto: lectura automática y escritura con OK', () => {
    expect(decideToolMode('mcp__github__list_issues', []).mode).toBe('auto')
    expect(decideToolMode('mcp__github__create_issue', []).mode).toBe('ask')
  })

  it('el modo solo borradores convierte escrituras en borrador pero no relaja prohibiciones', () => {
    expect(decideToolMode('mcp__jira__transition_issue', rules, { draftsOnly: true }).mode).toBe('draft')
    expect(decideToolMode('mcp__jira__search_issues', rules, { draftsOnly: true }).mode).toBe('auto')
    expect(decideToolMode('mcp__jira__delete_issue', rules, { draftsOnly: true }).mode).toBe('deny')
  })
})
