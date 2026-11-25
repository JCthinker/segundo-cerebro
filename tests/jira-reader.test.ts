import { describe, expect, it, vi } from 'vitest'

// Las preferencias de Jira se guardan en ajustes: los simulamos en memoria.
const store = new Map<string, string>()
vi.mock('../src/main/db', () => ({
  getSetting: (k: string) => store.get(k) ?? null,
  setSetting: (k: string, v: string | null) => (v === null ? store.delete(k) : store.set(k, v))
}))
vi.mock('../src/main/events', () => ({ dataChanged: () => undefined }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ aiMode: 'claude-code' }) }))
vi.mock('../src/main/agent/context', () => ({ baseSystem: (s: string) => s }))
vi.mock('../src/main/agent/client', () => ({}))
vi.mock('../src/main/agent/connectors', () => ({ connectorLabel: (n: string) => n, enabledConnectorNames: async () => [] }))

const { role, jiraPrefs, saveJiraPrefs } = await import('../src/main/jira')

describe('lector de Jira', () => {
  it('por defecto las columnas son el Status de Jira y el lector lee el Status normal', () => {
    expect(jiraPrefs().groupBy).toBe('status')
    expect(role('ROAD', 'FP')).toContain('el nombre exacto del Status del ticket')
    expect(role('ROAD', 'FP')).toContain('En "groupValue" pon siempre null')
    expect(role('ROAD', 'FP', '', '', false, 'Equipo')).toContain('valor del campo «Equipo»')
  })

  it('cambiar de criterio no vuelve a leer Jira, salvo que haga falta otro campo', () => {
    const p = jiraPrefs()
    expect(saveJiraPrefs({ ...p, groupBy: 'quarter' })).toBe(false)
    expect(saveJiraPrefs({ ...jiraPrefs(), hiddenCols: { quarter: ['Q1 - 2027'] } })).toBe(false)
    expect(jiraPrefs().hiddenCols.quarter).toEqual(['Q1 - 2027'])
    expect(saveJiraPrefs({ ...jiraPrefs(), groupBy: 'field', groupField: 'Equipo' })).toBe(true)
    expect(saveJiraPrefs({ ...jiraPrefs(), view: 'list' })).toBe(false)
  })
})
