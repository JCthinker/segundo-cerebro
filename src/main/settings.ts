import type { Settings } from '@shared/types'
import * as db from './db'
import { decrypt, encrypt } from './secrets'

export const DEFAULT_MODEL = 'claude-opus-5-5'

export function getSettings(): Settings {
  return {
    aiMode: (db.getSetting('aiMode') as Settings['aiMode']) ?? 'claude-code',
    hasApiKey: !!db.getSetting('apiKey'),
    model: db.getSetting('model') ?? DEFAULT_MODEL,
    briefHour: Number(db.getSetting('briefHour') ?? 8),
    useClaudeCodeConnections: db.getSetting('useClaudeCodeConnections') === '1',
    onboarded: db.getSetting('onboarded') === '1'
  }
}

export function updateSettings(patch: Partial<Settings> & { apiKey?: string | null }): Settings {
  if (patch.aiMode) db.setSetting('aiMode', patch.aiMode)
  if (patch.model !== undefined) db.setSetting('model', patch.model.trim() || DEFAULT_MODEL)
  if (patch.briefHour !== undefined) db.setSetting('briefHour', String(patch.briefHour))
  if (patch.useClaudeCodeConnections !== undefined) db.setSetting('useClaudeCodeConnections', patch.useClaudeCodeConnections ? '1' : '0')
  if (patch.onboarded !== undefined) db.setSetting('onboarded', patch.onboarded ? '1' : '0')
  if (patch.apiKey !== undefined) db.setSetting('apiKey', patch.apiKey ? encrypt(patch.apiKey.trim()) : null)
  return getSettings()
}

export function getApiKey(): string | null {
  const v = db.getSetting('apiKey')
  return v ? decrypt(v) : null
}
