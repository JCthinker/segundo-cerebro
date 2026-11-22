export type ItemKind = 'promise' | 'deadline' | 'task' | 'decision'
export type ItemStatus = 'proposed' | 'active' | 'done' | 'dismissed' | 'renegotiated'
export type SourceType = 'note' | 'capture' | 'calendar' | 'file' | 'transcript' | 'mcp' | 'manual'

export interface Item {
  id: string
  kind: ItemKind
  title: string
  person: string | null
  dueDate: string | null // YYYY-MM-DD
  prepDays: number
  areaId: string | null
  status: ItemStatus
  sourceType: SourceType
  sourceRef: string | null // id de nota, URL, clave Jira, ruta de archivo…
  sourceSnippet: string | null
  createdAt: string
  updatedAt: string
  doneAt: string | null
}

export interface Area {
  id: string
  name: string
  weight: number
}

export interface Note {
  id: string
  title: string
  contentJson: string
  plain: string
  createdAt: string
  updatedAt: string
}

export interface CalendarEvent {
  id: string
  sourceId: string
  title: string
  start: string // ISO
  end: string // ISO
  allDay: boolean
  location: string | null
  attendees: string[]
  description: string | null
}

export type ToolMode = 'auto' | 'ask' | 'draft' | 'deny'

export interface PermissionRule {
  pattern: string
  mode: ToolMode
}

export interface McpServer {
  id: string
  name: string // se usa como prefijo: mcp__<name>__<tool>
  config: McpServerConfigJson
  enabled: boolean
}

export type McpServerConfigJson =
  | { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> }
  | { type: 'sse'; url: string; headers?: Record<string, string> }

export interface Source {
  id: string
  kind: 'ics' | 'mcp'
  name: string
  config: Record<string, unknown>
  enabled: boolean
  lastSync: string | null
  lastError: string | null
}

export interface ScoredItem {
  item: Item
  score: number
  reasons: string[]
  atRisk: boolean
  daysToDue: number | null
}

export interface Brief {
  date: string
  generatedAt: string
  byAI: boolean
  summary: string
  top: { itemId: string; why: string }[]
  prepare: { eventId: string; title: string; start: string; checklist: string[] }[]
  letGo: { itemId: string; suggestion: string }[]
  rulesApplied: string[]
}

export interface ApprovalRequest {
  id: string
  runId: string
  toolName: string
  serverName: string | null
  input: Record<string, unknown>
}

export interface RunLogEntry {
  at: string
  type: 'text' | 'tool' | 'approved' | 'denied' | 'draft' | 'result' | 'error'
  text: string
  toolName?: string
  input?: unknown
}

export interface ActionRun {
  id: string
  itemId: string | null
  goal: string
  mode: 'normal' | 'drafts'
  status: 'running' | 'done' | 'error' | 'cancelled'
  log: RunLogEntry[]
  createdAt: string
}

export interface Settings {
  aiMode: 'claude-code' | 'api-key'
  hasApiKey: boolean
  model: string
  briefHour: number // 0-23, -1 = desactivado
  useClaudeCodeConnections: boolean
  /** Conexiones de la cuenta de claude.ai (p. ej. «claude.ai Gmail») que la app puede usar. */
  claudeConnectors: string[]
  onboarded: boolean
}

/** Conexión de tu cuenta de claude.ai (Gmail, Google Drive, Notion…), disponible vía Claude Code. */
export interface ClaudeConnector {
  name: string // «claude.ai Gmail»
  label: string // «Gmail»
  status: string // connected | needs-auth | failed | pending
  tools: number
  enabled: boolean
}

export interface AiStatus {
  ok: boolean
  detail: string
}

export interface TodayView {
  date: string
  ranked: ScoredItem[]
  events: CalendarEvent[]
  brief: Brief | null
  areas: Area[]
  proposedCount: number
  /** Lo detectado que espera tu confirmación. */
  proposed: Item[]
}

export const KIND_LABEL: Record<ItemKind, string> = {
  promise: 'Promesa',
  deadline: 'Entrega',
  task: 'Tarea',
  decision: 'Decisión'
}

export const MODE_LABEL: Record<ToolMode, string> = {
  auto: 'Automático',
  ask: 'Requiere OK',
  draft: 'Solo borrador',
  deny: 'Prohibido'
}
