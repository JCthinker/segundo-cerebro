import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { CLAUDE_AI_PREFIX, serverKey, serverOf } from '@shared/permissions'
import type { ClaudeConnector } from '@shared/types'
import { getSettings } from '../settings'
import { claudeExecutable } from './client'

/**
 * Conexiones de la cuenta de claude.ai (Gmail, Google Drive, Notion…).
 * Claude Code las carga solo en cada ejecución cuando hay sesión con claude.ai.
 * La app solo deja usar las que el usuario activa en Entradas; el resto se apagan.
 */

let cache: { at: number; list: Omit<ClaudeConnector, 'enabled'>[] } | null = null
const TTL = 10 * 60_000

export function isConnectorName(name: string): boolean {
  return /^claude\.ai\s/i.test(name)
}

export function connectorLabel(name: string): string {
  return name.replace(/^claude\.ai\s+/i, '')
}

/** Arranca Claude Code sin enviar nada al modelo y pregunta qué conexiones tiene. */
export async function listClaudeConnectors(env: Record<string, string | undefined>, refresh = false): Promise<ClaudeConnector[]> {
  const enabled = new Set(getSettings().claudeConnectors)
  if (getSettings().aiMode === 'api-key') return []
  if (!cache || refresh || Date.now() - cache.at > TTL) {
    let release: () => void = () => undefined
    async function* idle(): AsyncGenerator<SDKUserMessage> {
      await new Promise<void>((r) => (release = r))
    }
    const q = query({ prompt: idle(), options: { tools: [], settingSources: [], persistSession: false, env, ...claudeExecutable() } })
    try {
      // Las conexiones aparecen y se conectan pasados unos segundos: esperamos a que se asienten.
      let status = await q.mcpServerStatus()
      for (let i = 0; i < 15; i++) {
        const mine = status.filter((s) => isConnectorName(s.name))
        if (i >= 3 && mine.length && !mine.some((s) => s.status === 'pending')) break
        await new Promise((r) => setTimeout(r, 1000))
        status = await q.mcpServerStatus()
      }
      cache = {
        at: Date.now(),
        list: status
          .filter((s) => isConnectorName(s.name))
          .map((s) => ({ name: s.name, label: connectorLabel(s.name), status: s.status, tools: s.tools?.length ?? 0 }))
      }
    } finally {
      release()
      q.close()
    }
  }
  return cache.list.map((c) => ({ ...c, enabled: enabled.has(c.name) }))
}

export function knownConnectorNames(): string[] {
  return cache?.list.map((c) => c.name) ?? []
}

/** ¿Es una herramienta de una conexión de claude.ai? */
export function isConnectorTool(toolName: string): boolean {
  return (serverOf(toolName) ?? '').startsWith(CLAUDE_AI_PREFIX)
}

/** ¿Puede esta ejecución usar esta herramienta de claude.ai? */
export function connectorToolAllowed(toolName: string, allowed: string[]): boolean {
  const server = serverOf(toolName)
  return !!server && allowed.some((n) => serverKey(n) === server)
}
