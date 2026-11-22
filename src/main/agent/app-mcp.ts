import { connectorLabel } from './connectors'
import { createSdkMcpServer, tool, type McpServerConfig, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import * as db from '../db'
import { getSettings } from '../settings'

const json = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] })

/**
 * Herramientas internas: Claude trata tu segundo cerebro igual que Jira o Slack.
 * Nombres finales: mcp__cerebro__<herramienta>.
 */
export function cerebroServer(opts: { allowWrites: boolean; onChange?: () => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: SdkMcpToolDefinition<any>[] = [
    tool('search_notes', 'Busca en las notas del usuario por palabras. Devuelve id, título y un fragmento.', { query: z.string() }, async ({ query }) =>
      json(db.searchNotes(query))
    ),
    tool('get_note', 'Lee una nota completa por id.', { id: z.string() }, async ({ id }) => {
      const n = db.getNote(id)
      return json(n ? { id: n.id, title: n.title, text: n.plain, updatedAt: n.updatedAt } : { error: 'No existe' })
    }),
    tool(
      'list_items',
      'Lista promesas, entregas, tareas y decisiones. Por defecto, las activas.',
      {
        status: z.array(z.enum(['proposed', 'active', 'done', 'dismissed', 'renegotiated'])).optional(),
        kind: z.array(z.enum(['promise', 'deadline', 'task', 'decision'])).optional()
      },
      async ({ status, kind }) => {
        const areas = db.listAreas()
        return json(
          db.listItems({ status: status ?? ['active'], kind }).map((i) => ({
            id: i.id, kind: i.kind, title: i.title, person: i.person, dueDate: i.dueDate, prepDays: i.prepDays,
            area: areas.find((a) => a.id === i.areaId)?.name ?? null, status: i.status, source: i.sourceSnippet
          }))
        )
      }
    ),
    tool('get_workflow', 'Lee la página «Mi flujo» del usuario: sus prioridades, reglas, personas clave y permisos.', {}, async () =>
      json({ markdown: db.getWorkflow().markdown })
    ),
    tool(
      'get_events',
      'Eventos del calendario entre dos fechas (ISO 8601).',
      { from: z.string(), to: z.string() },
      async ({ from, to }) => json(db.listEvents(from, to))
    )
  ]

  if (opts.allowWrites) {
    tools.push(
      tool(
        'propose_item',
        'Propone un elemento nuevo (promesa, entrega, tarea o decisión). Queda en la bandeja hasta que el usuario lo confirme.',
        {
          kind: z.enum(['promise', 'deadline', 'task', 'decision']),
          title: z.string(),
          person: z.string().nullable().optional(),
          dueDate: z.string().nullable().optional().describe('YYYY-MM-DD'),
          prepDays: z.number().int().min(0).optional(),
          snippet: z.string().optional()
        },
        async (a) => {
          const item = db.createItem({
            kind: a.kind, title: a.title, person: a.person ?? null, dueDate: a.dueDate ?? null, prepDays: a.prepDays ?? 0,
            status: 'proposed', sourceType: 'mcp', sourceSnippet: a.snippet ?? null
          })
          opts.onChange?.()
          return json({ ok: true, id: item.id })
        }
      ),
      tool(
        'update_item',
        'Actualiza un elemento existente: por ejemplo, marcarlo como hecho (status "done") cuando la tarea quede resuelta.',
        {
          id: z.string(),
          status: z.enum(['active', 'done', 'renegotiated']).optional(),
          dueDate: z.string().nullable().optional(),
          title: z.string().optional()
        },
        async ({ id, ...patch }) => {
          const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
          const r = db.updateItem(id, clean)
          opts.onChange?.()
          return json(r ? { ok: true } : { error: 'No existe' })
        }
      )
    )
  }

  return createSdkMcpServer({ name: 'cerebro', version: '0.1.0', tools })
}

/** Servidores MCP del usuario activos, en el formato que espera el SDK. */
export function userMcpServers(only?: string[]): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {}
  for (const s of db.listMcpServers()) {
    if (!s.enabled) continue
    if (only && !only.includes(s.name)) continue
    out[s.name] = s.config as McpServerConfig
  }
  return out
}

export function connectedToolsSummary(): string {
  const s = getSettings()
  const names = [...Object.keys(userMcpServers()), ...(s.aiMode === 'claude-code' ? s.claudeConnectors.map(connectorLabel) : [])]
  const extra = getSettings().useClaudeCodeConnections ? ' y las conexiones que tengas en Claude Code' : ''
  return names.length ? `Herramientas conectadas: ${names.join(', ')}${extra}.` : `No hay herramientas externas conectadas${extra}.`
}
