import { addDays, toDay } from '@shared/dates'
import { fallbackWeekly, flowSignals, type FlowAction, type FlowEvent } from '@shared/flow'
import { buildBoard } from '@shared/jira'
import { MEETING_LABEL, meetingType, prepFromJira } from '@shared/meetings'
import { keepChecks } from '@shared/plan'
import { letGoCandidates, rankItems } from '@shared/priority'
import type { Brief, CalendarEvent, ScoredItem } from '@shared/types'
import * as db from '../db'
import { getSnapshot } from '../jira'
import { syncAllCalendars, syncAllPulls } from '../sources'
import { pendingNews, reviewNews } from '../novedades'
import { cerebroServer } from './app-mcp'
import { baseSystem } from './context'
import { runAgent } from './client'

export function dayRange(day: string): { from: string; to: string } {
  const start = new Date(`${day}T00:00:00`)
  const end = new Date(`${addDays(day, 1)}T00:00:00`)
  return { from: start.toISOString(), to: end.toISOString() }
}

/** Brief sin IA: siempre disponible. */
export function fallbackBrief(day: string, ranked: ScoredItem[], events: CalendarEvent[], upcoming: CalendarEvent[] = events, flow: FlowAction[] = [], week: FlowEvent[] = []): Brief {
  const meetings = events.filter((e) => !e.allDay)
  const top = ranked.slice(0, 3)
  const promisesDue = ranked.filter((s) => s.atRisk).length
  const parts = [`${meetings.length} ${meetings.length === 1 ? 'reunión' : 'reuniones'}`]
  if (promisesDue) parts.push(`${promisesDue} ${promisesDue === 1 ? 'cosa' : 'cosas'} en riesgo`)
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
    rulesApplied: [],
    weekly: flow.length || week.length ? fallbackWeekly(flow, week, new Date()) : undefined,
    flow: flow.map((f) => ({ key: f.key, title: f.title, why: f.why }))
  }
}

/** Agenda de los próximos 7 días, para saber cuándo son el grooming y la sprint planning. */
function weekEvents(day: string): CalendarEvent[] {
  return db.listEvents(dayRange(day).from, dayRange(addDays(day, 6)).to)
}

const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['weekly', 'flow', 'summary', 'top', 'prepare', 'letGo', 'rulesApplied'],
  properties: {
    weekly: { type: 'string', description: '«Lo que toca esta semana»: como mucho 3 frases cortas (máx. 70 palabras) sobre el flujo de producto (qué iniciativas empujar, qué preparar para el grooming y la sprint planning, qué medir) y por qué' },
    flow: {
      type: 'array',
      maxItems: 6,
      description: 'Flujo de producto para hoy, en orden. Usa las claves de accionesFlujo; si propones algo tuyo, clave «ai:» + algo corto',
      items: {
        type: 'object', additionalProperties: false, required: ['key', 'title', 'why'],
        properties: { key: { type: 'string' }, title: { type: 'string' }, why: { type: 'string', description: 'Por qué hoy, en una frase' } }
      }
    },
    summary: { type: 'string', description: 'Una o dos frases sobre el día: reuniones, tareas y encargos. No repitas lo de Jira, que ya va en weekly y flow' },
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

const BRIEF_ROLE = `Eres el asistente personal del usuario, un product manager, y preparas su brief diario.
Su trabajo principal es que Jira (ROAD: iniciativas; FP: tareas técnicas y épicas) esté al día y claro para el equipo de desarrollo.
Primero:
A. «weekly»: lo que toca esta semana en el flujo de producto. Mira «jira» (cuántas iniciativas hay en cada paso), «accionesFlujo» (lo que la app ha detectado que falta) y «agendaSemana» (grooming, sprint planning, reuniones con stakeholders). Decide tú qué es lo importante: si hace falta refinar más, hacer discovery, preparar el grooming o medir algo lanzado. Sin listas, en un párrafo.
B. «flow»: las acciones de producto de hoy en orden, cada una con su porqué. Usa las de «accionesFlujo» con su misma clave; puedes reescribir el porqué, quitar las que no toquen hoy y añadir como mucho dos tuyas (clave «ai:…»). Ten en cuenta lo que has aprendido de sus correcciones.
Después, el día:
Los elementos de tipo «promise» son encargos: algo que otra persona le ha pedido. Llámalos siempre «encargos».
Tienes una lista de elementos ya puntuados por una fórmula (compromiso, urgencia con margen de preparación, peso del área) y la agenda.
Tu trabajo:
1. Elegir las 3 cosas de hoy. Parte del orden de la puntuación, pero ajústalo con las reglas de «Mi flujo» y la agenda (huecos libres, días cargados). Explica el porqué en pocas palabras.
2. Para cada reunión de hoy y de mañana, una checklist corta (2-4 puntos) de qué preparar antes. En «yaSabidoDeJira» está lo que la app ya muestra sacado de Jira: no lo repitas, complétalo (contexto de notas, qué decidir, a quién preguntar). Usa search_notes y list_items para encontrar contexto relacionado con el título o los asistentes. Si no hay nada que preparar, deja la lista vacía.
3. Proponer qué puede soltar (aplazar o delegar). Nunca encargos de otras personas.
4. Indicar qué reglas de «Mi flujo» han influido.
En «novedades» está lo nuevo de sus herramientas que aún no ha repasado: si algo es urgente, menciónalo en el resumen. En «nuevoPorConfirmar» está lo recién detectado en notas y herramientas (Jira, correo…) que el usuario aún no ha confirmado. No lo pongas en las 3 cosas de hoy, pero si algo es importante o urgente, menciónalo en el resumen para que lo revise.
Usa solo ids que aparezcan en los datos.`

export async function generateBrief(useAI: boolean): Promise<Brief> {
  if (useAI) {
    // Antes de ordenar el día: calendario al día y lo nuevo de tus herramientas (Jira, correo…).
    await syncAllCalendars().catch(() => undefined)
    await syncAllPulls().catch(() => undefined)
    // Y lo nuevo de tus herramientas (Slack, correo, Drive…), que va a Novedades.
    await reviewNews().catch(() => undefined)
  }
  const day = toDay(new Date())
  const areas = db.listAreas()
  const ranked = rankItems(db.listItems({ status: ['active'] }), day, areas)
  const { from, to } = dayRange(day)
  const events = db.listEvents(from, to)
  const tomorrow = dayRange(addDays(day, 1))
  const tomorrowEvents = db.listEvents(tomorrow.from, tomorrow.to).filter((e) => !events.some((x) => x.id === e.id))
  const upcoming = [...events, ...tomorrowEvents]
  const week = weekEvents(day)
  const snap = getSnapshot()
  const signals = flowSignals(snap, week, new Date())
  const base = fallbackBrief(day, ranked, events, upcoming, signals, week)
  if (!useAI) {
    const kept = keepChecks(db.getBrief(day), base)
    db.saveBrief(kept)
    return kept
  }

  const meetingForPrompt = (e: CalendarEvent) => {
    const type = meetingType(e.title)
    return { id: e.id, titulo: e.title, tipo: MEETING_LABEL[type], inicio: e.start, fin: e.end, asistentes: e.attendees, notas: e.description, yaSabidoDeJira: prepFromJira(type, snap, new Date()) }
  }
  const data = {
    elementos: ranked.slice(0, 25).map((s) => ({
      id: s.item.id, tipo: s.item.kind, titulo: s.item.title, persona: s.item.person, vence: s.item.dueDate,
      margenDias: s.item.prepDays, puntuacion: s.score, motivos: s.reasons, enRiesgo: s.atRisk
    })),
    agendaHoy: events.map(meetingForPrompt),
    agendaManana: tomorrowEvents.map(meetingForPrompt),
    jira: snap
      ? buildBoard(snap, new Date()).map((c) => ({ paso: c.label, iniciativas: c.cards.map((x) => `${x.key} ${x.title}${x.quarter ? ` (${x.quarter})` : ''}${x.warnings.length ? ` — ${x.warnings.map((w) => w.text).join(', ')}` : ''}`) }))
      : 'Sin leer todavía',
    accionesFlujo: signals.map((f) => ({ clave: f.key, titulo: f.title, porque: f.why })),
    agendaSemana: week.filter((e) => !e.allDay).map((e) => ({ titulo: e.title, inicio: e.start })),
    novedades: pendingNews().slice(0, 10).map((n) => `${n.summary} (${n.tool})`),
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
    rulesApplied: out.rulesApplied,
    weekly: out.weekly || base.weekly,
    flow: out.flow?.length || !signals.length ? out.flow : base.flow
  }
  const kept = keepChecks(db.getBrief(day), brief)
  db.saveBrief(kept)
  return kept
}
