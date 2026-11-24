import { addDays, toDay } from '@shared/dates'
import * as db from './db'

/**
 * Lo que Claude aprende de cómo trabajas: cada vez que le corriges («No lo veo así»,
 * «No hace falta», «A otra»…) queda apuntado aquí. Lo lee en cada llamada y, con el tiempo,
 * propone convertirlo en reglas de Mi flujo.
 */

export interface Lesson {
  at: string
  /** Dónde pasó: brief, flujo, novedades… */
  where: string
  text: string
}

const KEY = 'learning.log'
const MAX = 200

export function listLessons(): Lesson[] {
  try {
    return JSON.parse(db.getSetting(KEY) ?? '[]') as Lesson[]
  } catch {
    return []
  }
}

export function learn(where: string, text: string): void {
  const t = text.trim()
  if (!t) return
  const all = [...listLessons(), { at: new Date().toISOString(), where, text: t.slice(0, 400) }]
  db.setSetting(KEY, JSON.stringify(all.slice(-MAX)))
}

/** Para el prompt: lo más reciente primero. */
export function lessonsForPrompt(n = 25): string {
  const last = listLessons().slice(-n).reverse()
  return last.map((l) => `- (${l.at.slice(0, 10)}, ${l.where}) ${l.text}`).join('\n')
}

// ---------- acciones del flujo ocultas ----------
const HIDDEN = 'flow.hidden'

export function hiddenFlow(): Record<string, string> {
  try {
    return JSON.parse(db.getSetting(HIDDEN) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

/** «Ahora no» la oculta hasta mañana; «No hace falta», dos semanas; «Hecho», tres días. */
export function hideFlow(key: string, how: 'later' | 'notNeeded' | 'done', title: string): void {
  const today = toDay(new Date())
  const until = addDays(today, how === 'later' ? 1 : how === 'done' ? 3 : 14)
  const map = Object.fromEntries(Object.entries(hiddenFlow()).filter(([, d]) => d > today))
  map[key] = until
  db.setSetting(HIDDEN, JSON.stringify(map))
  if (how === 'notNeeded') learn('flujo', `Dijo que no hacía falta: «${title}»`)
}

/** Olvida una corrección (por su fecha), por si Claude aprendió algo que no era. */
export function forgetLesson(at: string): void {
  db.setSetting(KEY, JSON.stringify(listLessons().filter((l) => l.at !== at)))
}

/** Correcciones desde la última vez que se convirtieron en reglas. */
export function lessonsSinceSuggest(): number {
  const since = db.getSetting('learning.suggestedAt') ?? ''
  return listLessons().filter((l) => l.at > since).length
}

export function markSuggested(): void {
  db.setSetting('learning.suggestedAt', new Date().toISOString())
}
