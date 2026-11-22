import { query, type CanUseTool, type EffortLevel, type McpServerConfig, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AiStatus } from '@shared/types'
import { getApiKey, getSettings } from '../settings'

export interface AgentEvent {
  type: 'text' | 'tool'
  text: string
  toolName?: string
  input?: unknown
}

export interface RunAgentOptions {
  prompt: string
  system: string
  mcpServers?: Record<string, McpServerConfig>
  /** Herramientas integradas de Claude Code permitidas (por defecto ninguna: solo MCP). */
  builtinTools?: string[]
  canUseTool?: CanUseTool
  outputSchema?: Record<string, unknown>
  effort?: EffortLevel
  maxTurns?: number
  onEvent?: (e: AgentEvent) => void
  abortController?: AbortController
}

export interface RunAgentResult {
  text: string
  structured: unknown
}

export class AiUnavailableError extends Error {}

function agentEnv(): Record<string, string | undefined> {
  const s = getSettings()
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'segundo-cerebro/0.1.0' }
  if (s.aiMode === 'api-key') {
    const key = getApiKey()
    if (!key) throw new AiUnavailableError('Falta la API key. Añádela en Ajustes.')
    env.ANTHROPIC_API_KEY = key
  } else {
    // Modo cuenta de Claude: que no se cuele una API key del entorno.
    delete env.ANTHROPIC_API_KEY
  }
  return env
}

/** Ejecuta el agente de Claude y devuelve el texto final (y la salida estructurada si se pidió). */
export async function runAgent(o: RunAgentOptions): Promise<RunAgentResult> {
  const s = getSettings()
  const q = query({
    prompt: o.prompt,
    options: {
      model: s.model,
      systemPrompt: o.system,
      tools: o.builtinTools ?? [],
      mcpServers: o.mcpServers ?? {},
      canUseTool: o.canUseTool ?? (async (_name, input) => ({ behavior: 'allow', updatedInput: input })),
      permissionMode: 'default',
      settingSources: s.useClaudeCodeConnections ? ['user'] : [],
      persistSession: false,
      maxTurns: o.maxTurns ?? 12,
      effort: o.effort ?? 'medium',
      env: agentEnv(),
      abortController: o.abortController,
      ...(o.outputSchema ? { outputFormat: { type: 'json_schema' as const, schema: o.outputSchema } } : {})
    }
  })

  let lastText = ''
  for await (const msg of q as AsyncIterable<SDKMessage>) {
    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text.trim() && !/not logged in|please run \/login/i.test(block.text)) {
          lastText = block.text
          o.onEvent?.({ type: 'text', text: block.text })
        } else if (block.type === 'tool_use') {
          o.onEvent?.({ type: 'tool', text: block.name, toolName: block.name, input: block.input })
        }
      }
    } else if (msg.type === 'result') {
      if (msg.subtype === 'success') {
        // Sin sesión o con error de API, el SDK devuelve "success" con is_error y el aviso como texto.
        if (msg.is_error || /not logged in|please run \/login/i.test(msg.result ?? '')) {
          throw new Error(msg.result || `Error de la API (${msg.api_error_status ?? 'desconocido'})`)
        }
        return { text: msg.result || lastText, structured: msg.structured_output ?? null }
      }
      const errors = 'errors' in msg && Array.isArray(msg.errors) ? msg.errors.join('; ') : ''
      throw new Error(explain(msg.subtype, errors))
    }
  }
  throw new Error('El agente terminó sin dar resultado.')
}

function explain(subtype: string, detail: string): string {
  if (subtype === 'error_max_turns') return 'Claude necesitó más pasos de los permitidos. Prueba con una petición más concreta.'
  if (subtype === 'error_max_structured_output_retries') return 'Claude no devolvió el formato esperado. Vuelve a intentarlo.'
  return `Error del agente (${subtype})${detail ? ': ' + detail : ''}`
}

/** Traduce errores habituales (sin sesión, sin red…) a algo comprensible. */
export function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/not logged in|login|authenticat|401|invalid api key|oauth/i.test(m)) {
    return getSettings().aiMode === 'api-key'
      ? 'La API key no es válida. Revísala en Ajustes.'
      : 'No hay sesión de Claude Code. Abre una terminal, ejecuta «claude» e inicia sesión, o usa una API key en Ajustes.'
  }
  if (/ENOTFOUND|ECONNREFUSED|network|fetch failed/i.test(m)) return 'No hay conexión con Claude. Revisa tu conexión a internet.'
  if (/rate limit|429|usage limit/i.test(m)) return 'Has llegado al límite de uso de Claude. Inténtalo más tarde.'
  return m
}

let lastStatus: AiStatus | null = null

export function cachedAiStatus(): AiStatus | null {
  return lastStatus
}

/** Comprueba que la IA responde con una petición mínima. */
export async function testAi(): Promise<AiStatus> {
  try {
    const r = await runAgent({
      prompt: 'Responde solo con la palabra: listo',
      system: 'Eres una comprobación de conexión. Responde con una sola palabra.',
      effort: 'low',
      maxTurns: 1
    })
    const mode = getSettings().aiMode === 'api-key' ? 'API key' : 'tu cuenta de Claude (Claude Code)'
    lastStatus = { ok: true, detail: `Conectado con ${mode}. Respuesta: «${r.text.trim().slice(0, 40)}»` }
  } catch (e) {
    lastStatus = { ok: false, detail: friendlyError(e) }
  }
  return lastStatus
}

export function markAiFailure(e: unknown): void {
  lastStatus = { ok: false, detail: friendlyError(e) }
}
export function markAiOk(): void {
  if (!lastStatus?.ok) lastStatus = { ok: true, detail: 'Conectado' }
}
