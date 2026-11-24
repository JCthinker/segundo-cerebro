/**
 * El flujo de producto: qué hay que hacer para que Jira esté al día, calculado sin IA a partir
 * de la copia de Jira y de la agenda. Claude luego lo ordena y lo explica en el brief.
 */
import { buildBoard, type JiraSnapshot } from './jira'

export type FlowKind = 'tasks' | 'epic' | 'discovery' | 'refine' | 'backlog' | 'measure' | 'other'

export interface FlowAction {
  /** Identifica la acción para poder ocultarla («Ahora no», «No hace falta»). */
  key: string
  title: string
  why: string
  kind: FlowKind
  /** Clave de Jira relacionada (ROAD-142), si la hay. */
  ref: string | null
  url: string | null
}

export interface FlowEvent {
  title: string
  start: string
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' })

/** Próxima reunión cuyo título encaja (grooming, sprint planning…). */
export function nextMeeting(events: FlowEvent[], pattern: RegExp, now: Date): FlowEvent | null {
  return events.filter((e) => pattern.test(e.title) && new Date(e.start) >= now).sort((a, b) => a.start.localeCompare(b.start))[0] ?? null
}

export function flowKey(kind: FlowKind, ref: string | null, title: string): string {
  return `${kind}:${ref ?? title.toLowerCase().slice(0, 60)}`
}

export function flowSignals(snap: JiraSnapshot | null, events: FlowEvent[], now: Date): FlowAction[] {
  if (!snap) return []
  const board = buildBoard(snap, now)
  const col = (id: string) => board.find((c) => c.id === id)?.cards ?? []
  const planning = nextMeeting(events, /sprint\s*planning|planning/i, now)
  const grooming = nextMeeting(events, /grooming|refinement|refinamiento/i, now)
  const out: FlowAction[] = []
  const add = (kind: FlowKind, title: string, why: string, ref: string | null = null, url: string | null = null) =>
    out.push({ key: flowKey(kind, ref, title), title, why, kind, ref, url })
  const beforePlanning = planning ? ` La sprint planning es el ${fmtDay(planning.start)}.` : ''

  // 1. Lo que bloquea la próxima sprint planning.
  for (const c of [...col('dev'), ...col('wip')]) {
    for (const w of c.warnings) {
      if (w.text === 'Sin tareas FP') add('tasks', `Crear las tareas FP de «${c.title}»`, `Está en ${c.status} y no tiene tareas en FP.${beforePlanning}`, c.key, c.url)
      else if (/FP sin preparar/.test(w.text)) add('tasks', `Describir y estimar las FP de «${c.title}»`, `${w.text}: tienen que estar creadas, descritas y estimadas.${beforePlanning}`, c.key, c.url)
      else if (w.text === 'Sin épica') add('epic', `Crear la épica de «${c.title}»`, 'Cada iniciativa en Ready to dev necesita su épica en FP con las mismas tareas.', c.key, c.url)
      else if (w.text === 'La épica no cuadra') add('epic', `Igualar la épica de «${c.title}» con sus tareas`, 'La épica de FP no tiene exactamente las mismas tareas que la iniciativa.', c.key, c.url)
    }
  }

  // 2. Discovery sin desarrollador.
  for (const c of col('discovery')) {
    if (!c.developers.length) add('discovery', `Conseguir un desarrollador para el discovery de «${c.title}»`, 'Sin desarrollador no hay discovery.', c.key, c.url)
  }

  // 3. Que no se seque el flujo.
  if (!col('dev').length && !col('refine').length)
    add('refine', 'Preparar iniciativas para el próximo grooming', `No hay nada en Ready to refine ni en Ready to dev: el equipo se quedará sin trabajo.${grooming ? ` El grooming es el ${fmtDay(grooming.start)}.` : ''}`)
  if (!col('discovery').length && !col('refine').length)
    add('discovery', 'Elegir el siguiente problema para discovery', 'No hay ninguna iniciativa en Discovery ni en Ready to refine: después de lo que hay ahora no queda nada preparado.')
  if (col('backlog').length < 2)
    add('backlog', 'Subir iniciativas al Backlog', `Solo ${col('backlog').length === 1 ? 'queda 1 iniciativa' : 'quedan 0 iniciativas'} en Backlog para contar en el grooming y pedir voluntarios.`)

  return out
}

/** Oculta lo marcado como «Ahora no» (hasta mañana) o «No hace falta» (dos semanas). */
export function visibleFlow(actions: FlowAction[], hidden: Record<string, string>, today: string): FlowAction[] {
  return actions.filter((a) => !(hidden[a.key] && hidden[a.key] > today))
}

/**
 * Une lo que calculó la app (al día) con el orden y las explicaciones de Claude (del brief).
 * Las acciones de Claude que ya no están en Jira (se arreglaron) desaparecen, salvo las suyas propias («ai:»).
 */
export function mergeFlow(
  signals: FlowAction[],
  fromBrief: { key: string; title: string; why: string }[] | undefined,
  hidden: Record<string, string>,
  today: string
): FlowAction[] {
  const byKey = new Map(signals.map((s) => [s.key, s]))
  const out: FlowAction[] = []
  const seen = new Set<string>()
  for (const b of fromBrief ?? []) {
    const s = byKey.get(b.key)
    if (!s && !b.key.startsWith('ai:')) continue
    if (seen.has(b.key)) continue
    seen.add(b.key)
    out.push(s ? { ...s, why: b.why || s.why } : { key: b.key, title: b.title, why: b.why, kind: 'other', ref: null, url: null })
  }
  for (const s of signals) if (!seen.has(s.key)) out.push(s)
  return visibleFlow(out, hidden, today)
}

/** Lectura semanal sin IA, por si Claude no está disponible. */
export function fallbackWeekly(signals: FlowAction[], events: FlowEvent[], now: Date): string {
  const planning = nextMeeting(events, /sprint\s*planning|planning/i, now)
  const grooming = nextMeeting(events, /grooming|refinement|refinamiento/i, now)
  const parts: string[] = []
  if (planning) parts.push(`La sprint planning es el ${fmtDay(planning.start)}`)
  if (grooming) parts.push(`el grooming, el ${fmtDay(grooming.start)}`)
  const head = parts.length ? `${parts.join(' y ')}. ` : ''
  if (!signals.length) return `${head}Jira está al día: no veo nada que bloquee al equipo.`
  return `${head}Lo primero: ${signals[0].title.charAt(0).toLowerCase()}${signals[0].title.slice(1)}.${signals.length > 1 ? ` Hay ${signals.length - 1} cosa${signals.length > 2 ? 's' : ''} más en el flujo de producto.` : ''}`
}
