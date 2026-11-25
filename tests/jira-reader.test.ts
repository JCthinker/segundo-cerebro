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
  it('por defecto reparte en columnas con el campo Status, no con Estado', () => {
    expect(jiraPrefs().columnField).toBe('Status')
    const r = role('ROAD', 'FP')
    expect(r).toContain('campo llamado «Status»')
    expect(r).toContain('el bueno es «Status»')
  })

  it('cambiar el campo de columnas obliga a volver a leer Jira', () => {
    const p = jiraPrefs()
    expect(saveJiraPrefs({ ...p, columnField: 'Fase' })).toBe(true)
    expect(jiraPrefs().columnField).toBe('Fase')
    expect(saveJiraPrefs({ ...jiraPrefs(), columnField: '  ' })).toBe(true)
    expect(jiraPrefs().columnField).toBe('Status')
    expect(saveJiraPrefs({ ...jiraPrefs(), view: 'list' })).toBe(false)
  })
})
