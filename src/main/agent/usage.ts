import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeUsage } from '@shared/types'
import { getSettings } from '../settings'
import { agentEnv, claudeExecutable, friendlyError } from './client'

let cache: ClaudeUsage | null = null
const TTL = 5 * 60_000

type Window = { utilization: number | null; resets_at: string | null } | null | undefined

/**
 * Pregunta a Claude Code cuánto llevas gastado de tu plan (lo mismo que /usage),
 * sin enviar nada al modelo, así que no gasta nada.
 */
export async function claudeUsage(refresh = false): Promise<ClaudeUsage> {
  if (getSettings().aiMode === 'api-key') {
    return { available: false, plan: null, windows: [], checkedAt: new Date().toISOString(), detail: 'Con API key no hay límites de plan que mostrar.' }
  }
  if (cache && !refresh && Date.now() - Date.parse(cache.checkedAt) < TTL) return cache

  let release: () => void = () => undefined
  async function* idle(): AsyncGenerator<SDKUserMessage> {
    await new Promise<void>((r) => (release = r))
  }
  const q = query({ prompt: idle(), options: { tools: [], settingSources: [], persistSession: false, env: agentEnv(), ...claudeExecutable() } })
  try {
    const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
    const rl = u.rate_limits
    const windows: ClaudeUsage['windows'] = []
    const add = (label: string, w: Window) => {
      if (w && typeof w.utilization === 'number') windows.push({ label, percent: Math.round(w.utilization), resetsAt: w.resets_at })
    }
    add('Últimas 5 horas', rl?.five_hour)
    add('Esta semana', rl?.seven_day)
    for (const m of rl?.model_scoped ?? []) add(`Semana · ${m.display_name}`, m)
    cache = {
      available: u.rate_limits_available && windows.length > 0,
      plan: u.subscription_type,
      windows,
      checkedAt: new Date().toISOString(),
      detail: windows.length ? undefined : 'Tu cuenta no da datos de consumo ahora mismo.'
    }
    return cache
  } catch (e) {
    return { available: false, plan: null, windows: [], checkedAt: new Date().toISOString(), detail: friendlyError(e) }
  } finally {
    release()
    q.close()
  }
}
