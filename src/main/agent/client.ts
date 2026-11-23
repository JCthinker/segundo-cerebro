import { app } from 'electron'
import { join } from 'node:path'
import { query, type CanUseTool, type EffortLevel, type McpServerConfig, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AiStatus } from '@shared/types'
import { serverKey } from '@shared/permissions'
import { modelFor, type ModelTier } from '@shared/models'
import { getApiKey, getSettings } from '../settings'
import { connectorToolAllowed, enabledConnectorNames, isConnectorTool, knownConnectorNames } from './connectors'

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
  /**
   * Conexiones de claude.ai que puede usar esta ejecución: 'enabled' = todas menos las que el usuario apagó,
   * o una lista concreta (siempre dentro de esas). Por defecto ninguna.
   */
  connectors?: 'enabled' | string[]
  outputSchema?: Record<string, unknown>
  /** «quick» (barato) para leer y decidir; «strong» (potente, por defecto) para proponer y ejecutar soluciones. */
  tier?: ModelTier
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

export function agentEnv(): Record<string, string | undefined> {
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

/**
 * En la app instalada, el ejecutable de Claude Code va fuera del paquete asar
 * (no se puede ejecutar desde dentro).
 */
export function claudeExecutable(): { pathToClaudeCodeExecutable?: string } {
  if (!app.isPackaged) return {}
  return {
    pathToClaudeCodeExecutable: join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, 'claude')
  }
}

/** Por defecto solo se permiten las herramientas internas de la app. */
const internalOnly: CanUseTool = async (name, input) =>
  name.startsWith('mcp__cerebro__')
    ? { behavior: 'allow', updatedInput: input }
    : { behavior: 'deny', message: 'Esta tarea no puede usar herramientas externas.' }

/** Ejecuta el agente de Claude y devuelve el texto final (y la salida estructurada si se pidió). */
export async function runAgent(o: RunAgentOptions): Promise<RunAgentResult> {
  const s = getSettings()
  const env = agentEnv()
  // Para saber qué conexiones hay (y quitar las apagadas) se buscan una vez y se guardan en caché.
  const usable = s.aiMode === 'claude-code' && o.connectors?.length ? await enabledConnectorNames(env) : []
  const allowed = o.connectors === 'enabled' ? usable : (o.connectors ?? []).filter((n) => usable.includes(n))
  // Sin conexiones permitidas, Claude Code no las carga. Con alguna, las demás se quitan.
  if (!allowed.length) env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false'
  const disallowedTools = knownConnectorNames()
    .filter((n) => !allowed.includes(n))
    .map((n) => `mcp__${serverKey(n)}`)
  const gate = o.canUseTool ?? internalOnly
  const canUseTool: CanUseTool = async (name, input, ctx) =>
    isConnectorTool(name) && !connectorToolAllowed(name, allowed)
      ? { behavior: 'deny', message: 'Esa conexión no está activada para la app.' }
      : gate(name, input, ctx)

  // Con conexiones de claude.ai, el mensaje se envía cuando ya están conectadas
  // (si no, Claude empieza sin verlas). Las que no se usan se apagan.
  let start: () => void = () => undefined
  let finish: () => void = () => undefined
  const started = new Promise<void>((r) => (start = r))
  const finished = new Promise<void>((r) => (finish = r))
  async function* streamed(): AsyncGenerator<SDKUserMessage> {
    await started
    yield { type: 'user', message: { role: 'user', content: o.prompt }, parent_tool_use_id: null }
    await finished
  }

  const q = query({
    prompt: allowed.length ? streamed() : o.prompt,
    options: {
      model: modelFor(o.tier ?? 'strong', s),
      systemPrompt: o.system,
      tools: o.builtinTools ?? [],
      mcpServers: o.mcpServers ?? {},
      canUseTool,
      disallowedTools,
      permissionMode: 'default',
      settingSources: s.useClaudeCodeConnections ? ['user'] : [],
      persistSession: false,
      maxTurns: o.maxTurns ?? 12,
      effort: o.effort ?? 'medium',
      env,
      ...claudeExecutable(),
      abortController: o.abortController,
      ...(o.outputSchema ? { outputFormat: { type: 'json_schema' as const, schema: o.outputSchema } } : {})
    }
  })

  if (allowed.length) {
    try {
      await waitForConnectors(q, allowed)
    } finally {
      start()
    }
  }

  try {
    return await consume(q, o)
  } finally {
    finish()
    if (allowed.length) q.close()
  }
}

/**
 * Espera a que las conexiones permitidas estén listas. (No usar toggleMcpServer para apagar
 * las demás: Claude Code guarda ese cambio en ~/.claude.json y afectaría al usuario fuera de la app.)
 */
async function waitForConnectors(q: Query, allowed: string[]): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const status = await q.mcpServerStatus()
    const mine = status.filter((st) => allowed.includes(st.name))
    if (mine.length === allowed.length && mine.every((st) => st.status !== 'pending')) return
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function consume(q: Query, o: RunAgentOptions): Promise<RunAgentResult> {
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
      tier: 'quick',
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
