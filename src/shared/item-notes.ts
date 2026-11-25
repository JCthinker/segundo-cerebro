import { addDays, toDay } from './dates'

/** Una nota o comentario que añades a una tarea («he hablado con Ana», «falta el dato de ventas»…). */
export interface ItemNote {
  id: string
  itemId: string
  text: string
  createdAt: string // ISO
}

/** Limpia el texto de una nota; null si no hay nada que guardar. */
export function cleanNoteText(text: string): string | null {
  const t = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return t ? t : null
}

/** Cuándo se escribió una nota, en corto: «hoy 10:30», «ayer 18:05», «3 nov 09:00». */
export function noteWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const hm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  const day = toDay(d)
  const today = toDay(now)
  if (day === today) return `hoy ${hm}`
  if (day === addDays(today, -1)) return `ayer ${hm}`
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return `${d.toLocaleDateString('es-ES', opts)} ${hm}`
}

/** Las notas de una tarea en texto, para que Claude las tenga en cuenta. */
export function notesForPrompt(notes: ItemNote[], now: Date = new Date()): string {
  if (!notes.length) return ''
  return '\n- Notas que ha ido añadiendo:\n' + notes.map((n) => `  · (${noteWhen(n.createdAt, now)}) ${n.text.replace(/\n/g, ' ')}`).join('\n')
}
