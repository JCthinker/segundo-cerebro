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
  sourceTool?: string | null // Slack, Gmail, Jira… cuando sale de una herramienta
  /** Explicación corta: qué ha pasado, por qué te toca y qué hay que hacer. */
  context?: string | null
  /** Por qué lo descartaste (para que Claude aprenda qué no proponerte). */
  dismissReason?: string | null
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
  /** Nota dentro de la que está (null = en el nivel principal). */
  parentId: string | null
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
  /** `done`: los puntos de la checklist que ya has marcado hoy. */
  prepare: { eventId: string; title: string; start: string; checklist: string[]; done?: string[] }[]
  letGo: { itemId: string; suggestion: string }[]
  rulesApplied: string[]
  /** Lo que toca esta semana, en un párrafo. */
  weekly?: string
  /** Acciones del flujo de producto en el orden que propone Claude. */
  flow?: { key: string; title: string; why: string }[]
}

/** Una acción del flujo de producto tal como se ve en Hoy. */
export interface FlowItem {
  key: string
  title: string
  why: string
  ref: string | null
  url: string | null
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
  type: 'user' | 'text' | 'tool' | 'approved' | 'denied' | 'draft' | 'result' | 'error' | 'plan'
  text: string
  toolName?: string
  input?: unknown
  /** En «denied»: true si lo rechazaste tú (no una regla de Mi flujo). */
  byUser?: boolean
  /** En «plan»: los pasos que propuso Claude. */
  steps?: string[]
}

export interface ActionRun {
  id: string
  itemId: string | null
  goal: string
  mode: 'normal' | 'drafts'
  /** planned: Claude preparó el plan y todavía no se ha lanzado. */
  status: 'planned' | 'running' | 'done' | 'error' | 'cancelled'
  log: RunLogEntry[]
  createdAt: string
}

export interface Settings {
  aiMode: 'claude-code' | 'api-key'
  hasApiKey: boolean
  /** Modelo potente: proponer y ejecutar soluciones (resolver tareas, chat). */
  model: string
  /** Modelo barato: leer canales, detectar tareas y preparar el plan del día. */
  quickModel: string
  briefHour: number // 0-23, -1 = desactivado
  useClaudeCodeConnections: boolean
  /** Conexiones de la cuenta de claude.ai (p. ej. «claude.ai Gmail») que el usuario ha apagado. Las demás se usan. */
  claudeConnectorsOff: string[]
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

/** Cuánto llevas gastado de tu plan de Claude (solo con cuenta de Claude, no con API key). */
export interface ClaudeUsage {
  available: boolean
  /** pro, max, team… */
  plan: string | null
  /** Límites del plan: % usado y cuándo se reinicia. */
  windows: { label: string; percent: number; resetsAt: string | null }[]
  checkedAt: string
  detail?: string
}

export interface AiStatus {
  ok: boolean
  detail: string
}

export interface TodayView {
  date: string
  ranked: ScoredItem[]
  /** Lo que has marcado como hecho hoy: se queda tachado hasta mañana por si quieres desmarcarlo. */
  doneToday: ScoredItem[]
  events: CalendarEvent[]
  brief: Brief | null
  areas: Area[]
  proposedCount: number
  /** Lo detectado que espera tu confirmación. */
  proposed: Item[]
  /** Flujo de producto · para hoy (sin lo que has ocultado). */
  flow: FlowItem[]
  /** Encargos activos (lo que te han pedido). */
  encargos: number
  /** Si ya respondiste a «lo que toca esta semana» de este brief. */
  weeklyAnswered: boolean
  /** Por reunión: tipo, qué llevar según Jira y su nota, si existe. */
  meetings: Record<string, MeetingInfo>
  /** Correcciones tuyas que Claude aún no ha propuesto convertir en reglas de Mi flujo. */
  lessonsNew: number
}

export interface MeetingInfo {
  type: import('./meetings').MeetingType
  label: string
  jira: string[]
  noteId: string | null
}

export const KIND_LABEL: Record<ItemKind, string> = {
  promise: 'Encargo',
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

/** Estado de las actualizaciones automáticas de la app. */
export interface UpdateStatus {
  /** idle: al día · checking · downloading · ready: lista para instalar al reiniciar · error · dev: en desarrollo, sin actualizar */
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'dev'
  current: string
  /** Versión nueva encontrada (al descargar o lista). */
  version?: string
  detail?: string
  checkedAt?: string
}
