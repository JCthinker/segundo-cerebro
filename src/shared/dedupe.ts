/**
 * Detecta si dos tareas hablan del mismo asunto aunque estén redactadas distinto
 * o vengan de canales diferentes (Slack, correo, Jira…).
 */
export interface TopicLike {
  title: string
  sourceRef?: string | null
  sourceSnippet?: string | null
}

const STOPWORDS = new Set(
  `a al ante con contra de del desde en entre hacia hasta para por segun sin sobre tras el la los las lo un una unos unas
  y o u e ni que se su sus mi mis tu tus le les me te nos es son esta este esto estos estas ese esa eso como mas muy ya
  hacer revisar enviar mandar pasar preparar tarea tareas sobre antes despues hoy manana`
    .split(/\s+/)
    .filter(Boolean)
)

/** Claves de ticket de Jira y similares: FP-123, ROAD-45. */
export function ticketKeys(text: string | null | undefined): string[] {
  if (!text) return []
  return [...new Set((text.match(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g) ?? []).map((k) => k.toUpperCase()))]
}

/** Palabras con significado del título, sin tildes ni palabras vacías, recortadas a su raíz. */
export function topicWords(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map((w) => w.slice(0, 5))
  return new Set(words)
}

export function sameTopic(a: TopicLike, b: TopicLike): boolean {
  const keysA = ticketKeys(`${a.title} ${a.sourceRef ?? ''} ${a.sourceSnippet ?? ''}`)
  if (keysA.length) {
    const keysB = new Set(ticketKeys(`${b.title} ${b.sourceRef ?? ''} ${b.sourceSnippet ?? ''}`))
    if (keysA.some((k) => keysB.has(k))) return true
  }
  const wa = topicWords(a.title)
  const wb = topicWords(b.title)
  if (!wa.size || !wb.size) return a.title.trim().toLowerCase() === b.title.trim().toLowerCase()
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared++
  const smaller = Math.min(wa.size, wb.size)
  // Un título corto contenido casi entero en otro, o la mayoría de palabras en común.
  return smaller >= 2 ? shared / smaller >= 0.75 : shared === 1 && Math.max(wa.size, wb.size) === 1
}

/**
 * Se queda solo con lo nuevo: quita lo que ya existe (o se descartó) y lo repetido
 * dentro del mismo lote. Con `max`, como mucho esa cantidad (en el orden recibido).
 */
export function onlyNew<T extends TopicLike>(candidates: T[], existing: TopicLike[], max = Infinity): T[] {
  const out: T[] = []
  for (const c of candidates) {
    if (out.length >= max) break
    if (!c.title?.trim()) continue
    if (existing.some((e) => sameTopic(c, e))) continue
    if (out.some((o) => sameTopic(c, o))) continue
    out.push(c)
  }
  return out
}
