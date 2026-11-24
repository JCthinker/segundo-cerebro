import { addDays, toDay } from '@shared/dates'
import { keepChecks } from '@shared/plan'
import { letGoCandidates, rankItems } from '@shared/priority'
import type { Brief, CalendarEvent, ScoredItem } from '@shared/types'
import * as db from '../db'
import { sweepConnectors, syncAllCalendars, syncAllPulls } from '../sources'
import { cerebroServer } from './app-mcp'
import { baseSystem } from './context'
import { runAgent } from './client'

export function dayRange(day: string): { from: string; to: string } {
  const start = new Date(`${day}T00:00:00`)
  const end = new Date(`${addDays(day, 1)}T00:00:00`)
  return { from: start.toISOString(), to: end.toISOString() }
}

/** Brief sin IA: siempre disponible. */
export function fallbackBrief(day: string, ranked: ScoredItem[], events: CalendarEvent[], upcoming: CalendarEvent[] = events): Brief {
  const meetings = events.filter((e) => !e.allDay)
  const top = ranked.slice(0, 3)
  const promisesDue = ranked.filter((s) => s.atRisk).length
  const parts = [`${meetings.length} ${meetings.length === 1 ? 'reunión' : 'reuniones'}`]
  if (promisesDue) parts.push(`${promisesDue} ${promisesDue === 1 ? 'promesa' : 'promesas'} en riesgo`)
  return {
    date: day,
    generatedAt: new Date().toISOString(),
    byAI: false,
    summary: top.length
      ? `Hoy: ${parts.join(' · ')}. Empieza por «${top[0].item.title}».`
      : `Hoy: ${parts.join(' · ')}. No hay nada urgente en tu lista.`,
    top: top.map((s) => ({ itemId: s.item.id, why: s.reasons.join(' · ') })),
    prepare: upcoming.filter((e) => !e.allDay).map((e) => ({ eventId: e.id, title: e.title, start: e.start, checklist: [] })),
    letGo: letGoCandidates(ranked).map((s) => ({ itemId: s.item.id, suggestion: 'Puede esperar' })),
    rulesApplied: []
  }
}

const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'top', 'prepare', 'letGo', 'rulesApplied'],
  properties: {
    summary: { type: 'string', description: 'Una o dos frases: cómo es el día y por dónde empezar' },
    top: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object', additionalProperties: false, required: ['itemId', 'why'],
        properties: { itemId: { type: 'string' }, why: { type: 'string', description: 'Motivo breve' } }
      }
    },
    prepare: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['eventId', 'checklist'],
        properties: { eventId: { type: 'string' }, checklist: { type: 'array', maxItems: 4, items: { type: 'string' } } }
      }
    },
    letGo: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object', additionalProperties: false, required: ['itemId', 'suggestion'],
        properties: { itemId: { type: 'string' }, suggestion: { type: 'string', description: 'Aplazar a cuándo, delegar en quién…' } }
      }
    },
    rulesApplied: { type: 'array', maxItems: 4, items: { type: 'string', description: 'Regla de Mi flujo que ha influido hoy' } }
  }
} as const

const BRIEF_ROLE = `Eres el asistente personal del usuario y preparas su brief diario.
Tienes una lista de elementos ya puntuados por una fórmula (compromiso, urgencia con margen de preparación, peso del área) y la agenda.
Tu trabajo:
1. Elegir las 3 cosas de hoy. Parte del orden de la puntuación, pero ajústalo con las reglas de «Mi flujo» y la agenda (huecos libres, días cargados). Explica el porqué en pocas palabras.
2. Para cada reunión de hoy y de mañana, una checklist corta (2-4 puntos) de qué preparar antes. Usa search_notes y list_items para encontrar contexto relacionado con el título o los asistentes. Si no hay nada que preparar, deja la lista vacía.
3. Proponer qué puede soltar (aplazar o delegar). Nunca promesas a otras personas.
4. Indicar qué reglas de «Mi flujo» han influido.
En «nuevoPorConfirmar» está lo recién detectado en notas y herramientas (Jira, correo…) que el usuario aún no ha confirmado. No lo pongas en las 3 cosas de hoy, pero si algo es importante o urgente, menciónalo en el resumen para que lo revise.
Usa solo ids que aparezcan en los datos.`

export async function generateBrief(useAI: boolean): Promise<Brief> {
  if (useAI) {
    // Antes de ordenar el día: calendario al día y lo nuevo de tus herramientas (Jira, correo…).
    await syncAllCalendars().catch(() => undefined)
    await syncAllPulls().catch(() => undefined)
    // Y las conexiones de tu cuenta de Claude que no tienen una lectura propia en Entradas.
    await sweepConnectors().catch(() => undefined)
  }
  const day = toDay(new Date())
  const areas = db.listAreas()
  const ranked = rankItems(db.listItems({ status: ['active'] }), day, areas)
  const { from, to } = dayRange(day)
  const events = db.listEvents(from, to)
  const tomorrow = dayRange(addDays(day, 1))
  const tomorrowEvents = db.listEvents(tomorrow.from, tomorrow.to).filter((e) => !events.some((x) => x.id === e.id))
  const upcoming = [...events, ...tomorrowEvents]
  const base = fallbackBrief(day, ranked, events, upcoming)
  if (!useAI) {
    const kept = keepChecks(db.getBrief(day), base)
    db.saveBrief(kept)
    return kept
  }

  const data = {
    elementos: ranked.slice(0, 25).map((s) => ({
      id: s.item.id, tipo: s.item.kind, titulo: s.item.title, persona: s.item.person, vence: s.item.dueDate,
      margenDias: s.item.prepDays, puntuacion: s.score, motivos: s.reasons, enRiesgo: s.atRisk
    })),
    agendaHoy: events.map((e) => ({ id: e.id, titulo: e.title, inicio: e.start, fin: e.end, asistentes: e.attendees, notas: e.description })),
    agendaManana: tomorrowEvents.map((e) => ({ id: e.id, titulo: e.title, inicio: e.start, fin: e.end, asistentes: e.attendees, notas: e.description })),
    // Lo detectado en notas y herramientas que el usuario aún no ha confirmado.
    nuevoPorConfirmar: db.listItems({ status: ['proposed'] }).slice(0, 15).map((i) => ({
      tipo: i.kind, titulo: i.title, persona: i.person, vence: i.dueDate, origen: i.sourceType
    }))
  }

  const r = await runAgent({
    system: baseSystem(BRIEF_ROLE),
    prompt: `Datos de hoy:\n${JSON.stringify(data, null, 2)}`,
    mcpServers: { cerebro: cerebroServer({ allowWrites: false }) },
    outputSchema: BRIEF_SCHEMA,
    tier: 'quick',
    effort: 'medium',
    maxTurns: 10
  })
  const out = r.structured as Omit<Brief, 'date' | 'generatedAt' | 'byAI'> & { prepare: { eventId: string; checklist: string[] }[] }
  if (!out) throw new Error('Claude no devolvió el brief.')

  const ids = new Set(ranked.map((s) => s.item.id))
  const top = out.top.filter((t) => ids.has(t.itemId))
  const brief: Brief = {
    date: day,
    generatedAt: new Date().toISOString(),
    byAI: true,
    summary: out.summary,
    top: top.length ? top : base.top,
    prepare: upcoming
      .filter((e) => !e.allDay)
      .map((e) => ({ eventId: e.id, title: e.title, start: e.start, checklist: out.prepare.find((p) => p.eventId === e.id)?.checklist ?? [] })),
    letGo: out.letGo.filter((l) => ids.has(l.itemId) && db.getItem(l.itemId)?.kind !== 'promise'),
    rulesApplied: out.rulesApplied
  }
  const kept = keepChecks(db.getBrief(day), brief)
  db.saveBrief(kept)
  return kept
}
