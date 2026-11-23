import ical, { type VEvent } from 'node-ical'
import { readFile } from 'node:fs/promises'
import type { CalendarEvent } from '@shared/types'

/** Convierte un .ics en eventos dentro de [from, to), expandiendo los recurrentes. */
export function parseIcs(text: string, sourceId: string, from: Date, to: Date): CalendarEvent[] {
  const data = ical.sync.parseICS(text)
  const out: CalendarEvent[] = []

  for (const key of Object.keys(data)) {
    const ev = data[key] as VEvent
    if (!ev || ev.type !== 'VEVENT' || !ev.start) continue
    if ((ev as { status?: string }).status === 'CANCELLED') continue
    const start = new Date(ev.start as unknown as Date)
    const end = ev.end ? new Date(ev.end as unknown as Date) : new Date(start.getTime() + 3600_000)
    const duration = end.getTime() - start.getTime()
    const allDay = (ev.datetype as string | undefined) === 'date'
    const attendees = toAttendees(ev.attendee)
    const base = {
      sourceId,
      title: text1(ev.summary) || '(sin título)',
      allDay,
      location: text1(ev.location) || null,
      attendees,
      description: text1(ev.description) || null
    }

    if (ev.rrule) {
      const exdates = new Set(Object.values(ev.exdate ?? {}).map((d) => new Date(d as Date).getTime()))
      for (const occ of ev.rrule.between(from, to, true)) {
        // rrule devuelve la hora "flotante"; corregimos con el desfase del evento original
        const occStart = new Date(occ)
        if (exdates.has(occStart.getTime())) continue
        out.push({
          ...base,
          id: `${sourceId}:${ev.uid}:${occStart.toISOString()}`,
          start: occStart.toISOString(),
          end: new Date(occStart.getTime() + duration).toISOString()
        })
      }
      continue
    }

    if (end <= from || start >= to) continue
    out.push({
      ...base,
      id: `${sourceId}:${ev.uid ?? key}`,
      start: start.toISOString(),
      end: end.toISOString()
    })
  }

  return out.sort((a, b) => a.start.localeCompare(b.start))
}

export async function loadIcs(location: string): Promise<string> {
  if (/^webcal:\/\//i.test(location)) location = location.replace(/^webcal:/i, 'https:')
  if (/^https?:\/\//i.test(location)) {
    const res = await fetch(location)
    if (!res.ok) throw new Error(`El calendario respondió ${res.status}`)
    return await res.text()
  }
  return await readFile(location, 'utf8')
}

function text1(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object' && 'val' in (v as object)) return String((v as { val: unknown }).val)
  return String(v)
}

function toAttendees(a: unknown): string[] {
  if (!a) return []
  const list = Array.isArray(a) ? a : [a]
  return list
    .map((x) => {
      if (typeof x === 'string') return x
      const o = x as { params?: { CN?: string }; val?: string }
      return o.params?.CN ?? o.val ?? ''
    })
    .map((s) => s.replace(/^mailto:/i, ''))
    .filter(Boolean)
}

/** Evento tal como lo devuelve Claude al leer una conexión de calendario. */
export type ConnectorEvent = { id: string; title: string; start: string; end: string; allDay: boolean; location: string | null; attendees: string[]; description: string | null }

/** Convierte los eventos leídos de una conexión de calendario al formato de la app. */
export function toCalendarEvents(raw: ConnectorEvent[], sourceId: string): CalendarEvent[] {
  const out: CalendarEvent[] = []
  for (const e of raw) {
    const allDay = !!e.allDay || /^\d{4}-\d{2}-\d{2}$/.test(e.start)
    // Un día completo «AAAA-MM-DD» se toma en hora local, no en UTC.
    const start = allDay && /^\d{4}-\d{2}-\d{2}$/.test(e.start) ? new Date(`${e.start}T00:00:00`) : new Date(e.start)
    let end = allDay && /^\d{4}-\d{2}-\d{2}$/.test(e.end) ? new Date(`${e.end}T00:00:00`) : new Date(e.end)
    if (isNaN(start.getTime())) continue
    if (isNaN(end.getTime()) || end <= start) end = new Date(start.getTime() + (allDay ? 86_400_000 : 3_600_000))
    out.push({
      id: `${sourceId}:${e.id || e.title}:${start.toISOString()}`,
      sourceId,
      title: e.title || '(sin título)',
      start: start.toISOString(),
      end: end.toISOString(),
      allDay,
      location: e.location || null,
      attendees: e.attendees ?? [],
      description: e.description || null
    })
  }
  return out.sort((a, b) => a.start.localeCompare(b.start))
}
