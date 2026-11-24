import { meetingNoteTitle } from '@shared/meetings'
import type { CalendarEvent } from '@shared/types'
import * as db from './db'
import { baseSystem } from './agent/context'
import { runAgent } from './agent/client'
import { getSnapshot } from './jira'

/**
 * Notas de reunión: cada reunión tiene su nota dentro de la carpeta «Reuniones», y al acabar
 * Claude la repasa y propone qué va a Jira ROAD/FP y qué es un encargo para tu lista.
 */

const LINKS = 'meeting.notes'
const FOLDER = 'notes.meetingsFolder'

function links(): Record<string, string> {
  try {
    return JSON.parse(db.getSetting(LINKS) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

/** Nota ya creada para cada reunión (solo las que existen todavía). */
export function meetingNoteIds(): Record<string, string> {
  return Object.fromEntries(Object.entries(links()).filter(([, n]) => db.getNote(n)))
}

function meetingsFolder(): string {
  const id = db.getSetting(FOLDER)
  if (id && db.getNote(id)) return id
  const n = db.createNote('Reuniones', null)
  db.setSetting(FOLDER, n.id)
  return n.id
}

/** Abre (o crea) la nota de una reunión. */
export function noteForMeeting(e: CalendarEvent): string {
  const existing = meetingNoteIds()[e.id]
  if (existing) return existing
  const n = db.createNote(meetingNoteTitle(e.title, e.start), meetingsFolder())
  db.setSetting(LINKS, JSON.stringify({ ...links(), [e.id]: n.id }))
  return n.id
}

export type ReviewTag = 'DECISION' | 'TAREA_FP' | 'PREGUNTA' | 'PARTICIPA' | 'ENCARGO'

export interface ReviewEntry {
  tag: ReviewTag
  text: string
  /** Iniciativa de ROAD a la que se refiere, si la hay. */
  roadKey: string | null
  /** Quién: el voluntario, quien pide el encargo, a quién preguntar. */
  person: string | null
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['entries'],
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tag', 'text', 'roadKey', 'person'],
        properties: {
          tag: { type: 'string', enum: ['DECISION', 'TAREA_FP', 'PREGUNTA', 'PARTICIPA', 'ENCARGO'] },
          text: { type: 'string', description: 'Frase corta y clara, lista para copiar a Jira o a la lista' },
          roadKey: { type: ['string', 'null'], description: 'Clave ROAD-… de la iniciativa, solo si aparece en «iniciativas»' },
          person: { type: ['string', 'null'] }
        }
      }
    }
  }
} as const

const REVIEW_ROLE = `Repasas la nota de una reunión de un product manager y la repartes:
- DECISION: algo que se decidió sobre una iniciativa (va como conclusión a Jira ROAD).
- TAREA_FP: trabajo técnico para el equipo que hay que crear en FP.
- PREGUNTA: algo que quedó abierto y hay que resolver.
- PARTICIPA: alguien se ofreció o fue elegido para el discovery de una iniciativa.
- ENCARGO: algo que otra persona le pidió al usuario (va a su lista, no a Jira).
Relaciona cada cosa con su iniciativa de ROAD cuando esté clara, usando solo las claves de «iniciativas». Solo lo que esté en la nota; no inventes.`

export async function reviewNote(noteId: string): Promise<ReviewEntry[]> {
  const note = db.getNote(noteId)
  if (!note) throw new Error('No encuentro la nota.')
  if (note.plain.trim().length < 10) throw new Error('La nota está casi vacía.')
  const snap = getSnapshot()
  const iniciativas = snap?.initiatives.map((i) => `${i.key} ${i.title} (${i.status})`) ?? []
  const r = await runAgent({
    system: baseSystem(REVIEW_ROLE),
    prompt: `iniciativas:\n${iniciativas.join('\n') || '(Jira sin leer)'}\n\nNota «${note.title}»:\n${note.plain.slice(0, 20000)}`,
    outputSchema: REVIEW_SCHEMA as unknown as Record<string, unknown>,
    tier: 'quick',
    effort: 'low',
    maxTurns: 3
  })
  const out = r.structured as { entries: ReviewEntry[] } | null
  if (!out) throw new Error('Claude no devolvió el reparto.')
  const keys = new Set(snap?.initiatives.map((i) => i.key) ?? [])
  return out.entries.map((e) => ({ ...e, roadKey: e.roadKey && keys.has(e.roadKey) ? e.roadKey : null }))
}
