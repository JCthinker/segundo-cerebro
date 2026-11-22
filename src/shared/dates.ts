/** Fechas como YYYY-MM-DD en hora local. */
export function toDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day)
  d.setDate(d.getDate() + n)
  return toDay(d)
}

/** Días enteros de `from` a `to` (positivo si `to` es posterior). */
export function diffDays(from: string, to: string): number {
  const ms = parseDay(to).getTime() - parseDay(from).getTime()
  return Math.round(ms / 86_400_000)
}

export function formatDayLong(day: string): string {
  return parseDay(day).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function formatRelative(today: string, due: string): string {
  const n = diffDays(today, due)
  if (n === 0) return 'hoy'
  if (n === 1) return 'mañana'
  if (n === -1) return 'ayer'
  if (n < 0) return `hace ${-n} días`
  if (n < 7) return `en ${n} días`
  return parseDay(due).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}
