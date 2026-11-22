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
