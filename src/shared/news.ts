/**
 * Novedades: lo nuevo de tus herramientas (Slack, correo, Drive, Jira…) que Claude ha leído
 * y clasificado, a la espera de que digas qué hacer con ello.
 */

/** Qué propone Claude: añadirlo a algo que ya existe, crear un encargo, llevarlo a producto o nada. */
export type NewsAction = 'add' | 'encargo' | 'product' | 'noise'

export interface NewsTarget {
  /** 'item': una tarea o encargo tuyo; 'road': una iniciativa de Jira ROAD. */
  kind: 'item' | 'road'
  id: string
  title: string
}

export interface NewsEntry {
  id: string
  at: string
  /** Enlace o identificador del mensaje, para no volver a leerlo. */
  ref: string
  tool: string
  from: string | null
  /** Qué ha pasado, en una frase. */
  summary: string
  action: NewsAction
  /** Para «add»: dónde añadirlo. */
  target: NewsTarget | null
  /** Para «encargo» o «product»: el título propuesto. */
  title: string | null
  why: string
}

export const NEWS_ACTION_LABEL: Record<NewsAction, string> = {
  add: 'Añadir a',
  encargo: 'Nuevo encargo',
  product: 'Para producto',
  noise: 'Sin importancia'
}

/** Recuerda lo ya leído (los más recientes primero), sin crecer sin límite. */
export function rememberSeen(seen: string[], refs: string[], max = 600): string[] {
  const fresh = refs.map((r) => r.trim()).filter((r) => r && !seen.includes(r))
  return [...fresh, ...seen].slice(0, max)
}

/** Lo que entra en la bandeja: sin ruido, sin repetidos y sin lo ya visto. */
export function acceptNews(incoming: NewsEntry[], pending: NewsEntry[], seen: string[]): NewsEntry[] {
  const known = new Set([...seen, ...pending.map((p) => p.ref)])
  const out: NewsEntry[] = []
  for (const n of incoming) {
    if (n.action === 'noise' || !n.ref || known.has(n.ref)) continue
    known.add(n.ref)
    out.push(n)
  }
  return out
}
