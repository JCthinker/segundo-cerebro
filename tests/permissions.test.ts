import { describe, expect, it } from 'vitest'
import { decideToolMode, isReadOnlyTool, parsePermissions, stepEffect } from '@shared/permissions'

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

  it('por defecto: leer es automático; escribir o enviar pide OK', () => {
    expect(decideToolMode('mcp__github__list_issues', []).mode).toBe('auto')
    expect(decideToolMode('mcp__github__create_issue', []).mode).toBe('ask')
    expect(decideToolMode('mcp__slack__send_message', []).mode).toBe('ask')
  })

  it('el modo solo borradores convierte escrituras en borrador pero no relaja prohibiciones', () => {
    expect(decideToolMode('mcp__jira__transition_issue', rules, { draftsOnly: true }).mode).toBe('draft')
    expect(decideToolMode('mcp__jira__search_issues', rules, { draftsOnly: true }).mode).toBe('auto')
    expect(decideToolMode('mcp__jira__delete_issue', rules, { draftsOnly: true }).mode).toBe('deny')
  })
})

describe('conexiones de la cuenta de claude.ai', () => {
  const rules = parsePermissions('## Permisos\n- gmail: solo borrador\n- google drive: automático\n')
  it('«gmail» se aplica a mcp__claude_ai_Gmail__*', () => {
    expect(decideToolMode('mcp__claude_ai_Gmail__send_message', rules).mode).toBe('draft')
    expect(decideToolMode('mcp__claude_ai_Google_Drive__create_file', rules).mode).toBe('auto')
  })
  it('crear un borrador está permitido con «solo borrador» y en modo borradores', () => {
    expect(decideToolMode('mcp__claude_ai_Gmail__create_draft', rules).mode).toBe('auto')
    expect(decideToolMode('mcp__claude_ai_Gmail__create_draft', [], { draftsOnly: true }).mode).toBe('auto')
    expect(decideToolMode('mcp__claude_ai_Gmail__create_draft', []).mode).toBe('ask')
  })
  it('leer sigue siendo automático y prohibido gana', () => {
    expect(decideToolMode('mcp__claude_ai_Gmail__search_threads', rules).mode).toBe('auto')
    const deny = parsePermissions('## Permisos\n- gmail: solo borrador\n- *draft*: prohibido\n')
    expect(decideToolMode('mcp__claude_ai_Gmail__create_draft', deny).mode).toBe('deny')
  })
})

describe('qué pasará con cada paso del plan', () => {
  const rules = parsePermissions('## Permisos\n- gmail: solo borrador\n- jira: automático\n- slack: prohibido\n')
  it('consultar y lo de la app se hacen solos', () => {
    expect(stepEffect('read', 'Slack', rules)).toBe('auto')
    expect(stepEffect('app', null, rules)).toBe('auto')
  })
  it('escribir sigue tus permisos y, sin regla, pide OK', () => {
    expect(stepEffect('write', 'Gmail', rules)).toBe('draft')
    expect(stepEffect('write', 'Jira', rules)).toBe('auto')
    expect(stepEffect('write', 'Slack', rules)).toBe('deny')
    expect(stepEffect('write', 'Google Drive', rules)).toBe('ask')
    expect(stepEffect('write', 'Jira', rules, { draftsOnly: true })).toBe('draft')
  })
})
