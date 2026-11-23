/**
 * Detecta si dos tareas son la misma acción dicha con otras palabras.
 * Varias tareas distintas sobre un mismo asunto (o un mismo ticket) sí se permiten.
 */
export interface TaskLike {
  title: string
}

const STOPWORDS = new Set(
  `a al ante con contra de del desde en entre hacia hasta para por segun sin sobre tras el la los las lo un una unos unas
  y o u e ni que se su sus mi mis tu tus le les me te nos es son esta este esto estos estas ese esa eso como mas muy ya
  tarea tareas hoy manana antes despues`
    .split(/\s+/)
    .filter(Boolean)
)

/** Verbos que significan lo mismo: se reducen a una sola raíz. */
const SAME_VERB: Record<string, string> = {
  manda: 'envia', remit: 'envia',
  compr: 'revis', verif: 'revis', repas: 'revis', chequ: 'revis',
  abrir: 'crear', regis: 'crear', anadi: 'crear',
  avisa: 'recor', recue: 'recor', comun: 'recor'
}

/** Claves de ticket de Jira y similares: FP-123, ROAD-45. */
export function ticketKeys(text: string | null | undefined): string[] {
  if (!text) return []
  return [...new Set((text.match(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g) ?? []).map((k) => k.toUpperCase()))]
}

/** Palabras con significado del título, sin tildes ni palabras vacías, recortadas a su raíz. */
export function taskWords(title: string): Set<string> {
  const words = title
    .replace(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map((w) => {
      const root = w.slice(0, 5)
      return SAME_VERB[root] ?? SAME_VERB[w] ?? root
    })
  return new Set(words)
}

export function sameTask(a: TaskLike, b: TaskLike): boolean {
  if (a.title.trim().toLowerCase() === b.title.trim().toLowerCase()) return true
  const keysA = ticketKeys(a.title)
  const keysB = ticketKeys(b.title)
  // Tickets distintos: tareas distintas.
  if (keysA.length && keysB.length && !keysA.some((k) => keysB.includes(k))) return false
  const wa = taskWords(a.title)
  const wb = taskWords(b.title)
  if (!wa.size || !wb.size) return false
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared++
  const smaller = Math.min(wa.size, wb.size)
  if (smaller === 1) return shared === 1 && Math.max(wa.size, wb.size) === 1
  // Casi todas las palabras del título más corto están en el otro.
  return shared / smaller >= 0.75
}

/** Se queda solo con lo nuevo: quita lo que ya existe (o se descartó) y lo repetido dentro del mismo lote. */
export function onlyNew<T extends TaskLike>(candidates: T[], existing: TaskLike[]): T[] {
  const out: T[] = []
  for (const c of candidates) {
    if (!c.title?.trim()) continue
    if (existing.some((e) => sameTask(c, e))) continue
    if (out.some((o) => sameTask(c, o))) continue
    out.push(c)
  }
  return out
}

/** Nombre de la herramienta a partir de un enlace, para tareas antiguas que no lo guardaron. */
export function toolFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null
  if (!/^https?:\/\//.test(ref)) return null
  const host = (() => {
    try {
      return new URL(ref).hostname
    } catch {
      return ''
    }
  })()
  const known: [RegExp, string][] = [
    [/mail\.google\./, 'Gmail'],
    [/calendar\.google\./, 'Google Calendar'],
    [/(docs|drive)\.google\./, 'Google Drive'],
    [/slack\.com$/, 'Slack'],
    [/atlassian\.net$|jira/, 'Jira'],
    [/notion\.(so|site)$/, 'Notion'],
    [/outlook\.|office\.com$|live\.com$/, 'Outlook'],
    [/github\.com$/, 'GitHub'],
    [/linear\.app$/, 'Linear']
  ]
  return known.find(([re]) => re.test(host))?.[1] ?? null
}
