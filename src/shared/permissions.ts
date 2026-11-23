import type { PermissionRule, ToolMode } from './types'

/**
 * Lee la sección "## Permisos" de Mi flujo. Formato de cada línea:
 *   - <patrón>: <modo>
 * El patrón puede ser el nombre de un servidor ("jira"), una herramienta
 * ("slack.send_message" o "mcp__slack__send_message") o usar comodines ("*send*").
 * Modo: automático | requiere ok | solo borrador | prohibido
 */
export function parsePermissions(markdown: string): PermissionRule[] {
  const lines = markdown.split(/\r?\n/)
  const rules: PermissionRule[] = []
  let inSection = false
  for (const raw of lines) {
    const line = raw.trim()
    if (/^#{1,6}\s/.test(line)) {
      inSection = /^#{1,6}\s+permisos\b/i.test(line)
      continue
    }
    if (!inSection) continue
    const m = line.match(/^[-*]\s+`?([^:`]+?)`?\s*:\s*(.+)$/)
    if (!m) continue
    const mode = parseMode(m[2])
    if (mode) rules.push({ pattern: m[1].trim(), mode })
  }
  return rules
}

export function parseMode(text: string): ToolMode | null {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  if (/prohibid|nunca|deny/.test(t)) return 'deny'
  if (/borrador|draft/.test(t)) return 'draft'
  if (/automatic|auto\b|sin preguntar|siempre/.test(t)) return 'auto'
  if (/requiere|ok|pregunta|confirm|ask/.test(t)) return 'ask'
  return null
}

const READ_WORDS = new Set([
  'get', 'list', 'search', 'read', 'fetch', 'query', 'find', 'lookup', 'view', 'show',
  'describe', 'retrieve', 'download', 'count', 'status', 'history', 'info'
])
const WRITE_WORDS = new Set([
  'send', 'post', 'create', 'update', 'delete', 'remove', 'write', 'edit', 'add', 'move',
  'transition', 'assign', 'archive', 'reply', 'forward', 'upload', 'set', 'trash', 'cancel',
  'comment', 'react', 'invite', 'share', 'merge', 'close', 'publish', 'schedule', 'draft'
])

function words(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** Una herramienta es de lectura si su nombre tiene un verbo de lectura y ninguno de escritura. */
export function isReadOnlyTool(toolName: string): boolean {
  const w = words(shortToolName(toolName))
  if (w.some((x) => WRITE_WORDS.has(x))) return false
  return w.some((x) => READ_WORDS.has(x))
}

export function serverOf(toolName: string): string | null {
  const m = toolName.match(/^mcp__(.+?)__/)
  return m ? m[1] : null
}

/** Prefijo que Claude Code da a las conexiones de la cuenta de claude.ai: mcp__claude_ai_Gmail__… */
export const CLAUDE_AI_PREFIX = 'claude_ai_'

/** Nombre corto y legible del servidor: «claude_ai_Gmail» → «Gmail». */
export function serverLabel(server: string): string {
  return server.startsWith(CLAUDE_AI_PREFIX) ? server.slice(CLAUDE_AI_PREFIX.length).replace(/_/g, ' ') : server
}

/** Clave de servidor en los nombres de herramienta: «claude.ai Gmail» → «claude_ai_Gmail». */
export function serverKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/** Herramientas que solo crean o editan un borrador (no envían nada): create_draft, update_draft… */
export function isDraftTool(toolName: string): boolean {
  const w = words(shortToolName(toolName))
  return w.includes('draft') && !w.some((x) => ['send', 'delete', 'remove', 'trash', 'publish'].includes(x))
}

/** Herramientas que borran algo (no se puede deshacer). */
export function isDestructiveTool(toolName: string): boolean {
  return words(shortToolName(toolName)).some((x) => ['delete', 'remove', 'trash', 'destroy', 'purge'].includes(x))
}

export function shortToolName(toolName: string): string {
  const m = toolName.match(/^mcp__.+?__(.+)$/)
  return m ? m[1] : toolName
}

function globToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${esc}$`, 'i')
}

function ruleMatches(pattern: string, toolName: string): boolean {
  const server = serverOf(toolName)
  const short = shortToolName(toolName)
  const p = pattern.trim()
  const candidates = [toolName, short]
  // «gmail» también vale para la conexión de claude.ai «claude_ai_Gmail».
  const names = server ? [...new Set([server, serverLabel(server).replace(/\s+/g, '_')])] : []
  for (const n of names) candidates.push(`${n}.${short}`, `${n}/${short}`)
  if (!/[.*/_]/.test(p) && names.some((n) => p.toLowerCase().replace(/\s+/g, '_') === n.toLowerCase())) return true
  const re = globToRegex(p)
  return candidates.some((c) => re.test(c))
}

/**
 * Qué pasará con un paso del plan: consultar es automático; lo de dentro de la app (apuntar,
 * marcar como hecha) también; escribir o enviar en una herramienta sigue tus permisos.
 */
export function stepEffect(
  kind: 'read' | 'app' | 'write',
  tool: string | null,
  rules: PermissionRule[],
  opts: { draftsOnly?: boolean } = {}
): ToolMode {
  if (kind === 'read' || kind === 'app') return 'auto'
  const server = serverKey((tool ?? 'herramienta').trim()).replace(/_+/g, '_') || 'herramienta'
  return decideToolMode(`mcp__${server}__send`, rules, opts).mode
}

const MODE_RANK: Record<ToolMode, number> = { auto: 0, ask: 1, draft: 2, deny: 3 }

/**
 * Decide qué hacer con una llamada a herramienta.
 *  - Las herramientas internas de la app (mcp__cerebro__*) son automáticas.
 *  - Si alguna regla coincide, gana la más específica (la última que coincide;
 *    en empate, la más restrictiva).
 *  - Sin regla: lectura → automático; escribir o enviar algo → requiere tu OK.
 *  - En modo "solo borradores", cualquier escritura pasa a borrador.
 */
export function decideToolMode(
  toolName: string,
  rules: PermissionRule[],
  opts: { draftsOnly?: boolean } = {}
): { mode: ToolMode; reason: string } {
  if (toolName.startsWith('mcp__cerebro__')) return { mode: 'auto', reason: 'Herramienta interna de la app' }

  let decided: { mode: ToolMode; reason: string } | null = null
  let bestSpecificity = -1
  for (const r of rules) {
    if (!ruleMatches(r.pattern, toolName)) continue
    const specificity = r.pattern.replace(/\*/g, '').length
    if (
      specificity > bestSpecificity ||
      (specificity === bestSpecificity && decided && MODE_RANK[r.mode] > MODE_RANK[decided.mode])
    ) {
      bestSpecificity = specificity
      decided = { mode: r.mode, reason: `Regla de Mi flujo: «${r.pattern}»` }
    }
  }

  if (!decided) {
    decided = isReadOnlyTool(toolName)
      ? { mode: 'auto', reason: 'Solo lectura' }
      : { mode: 'ask', reason: 'Escribe o envía algo: necesita tu OK' }
  }

  // «Solo borrador» limita lo que escribe o envía; leer sigue permitido.
  if (decided.mode === 'draft' && isReadOnlyTool(toolName)) {
    return { mode: 'auto', reason: 'Solo lectura' }
  }
  // Crear un borrador (p. ej. en Gmail) no envía nada: es justo lo que pide «solo borrador».
  if (isDraftTool(toolName) && decided.mode !== 'deny' && (decided.mode === 'draft' || opts.draftsOnly)) {
    return { mode: 'auto', reason: 'Solo crea un borrador, no envía nada' }
  }
  if (opts.draftsOnly && decided.mode !== 'deny' && !isReadOnlyTool(toolName)) {
    return { mode: 'draft', reason: 'Modo solo borradores' }
  }
  return decided
}
