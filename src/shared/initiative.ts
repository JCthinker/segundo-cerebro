/**
 * Ficha de una iniciativa de ROAD: su camino por los pasos, qué le toca ahora y las
 * conclusiones de reuniones que tienen que quedar registradas en Jira.
 */
import { ROAD_STAGES, stageOf, type JiraInitiative, type JiraSnapshot, type StageId } from './jira'
import { sprintRowFor } from './sprint'

/** Una conclusión de una reunión que pertenece a una iniciativa. */
export interface RoadNote {
  id: string
  at: string
  key: string
  /** DECISION, TAREA_FP, PREGUNTA, PARTICIPA. */
  tag: string
  text: string
  /** Nota de la que sale. */
  noteId: string | null
  noteTitle: string | null
  /** Si ya está escrita en Jira. */
  registered: boolean
}

export const ROAD_NOTE_LABEL: Record<string, string> = {
  DECISION: 'Decisión',
  TAREA_FP: 'Tarea FP',
  PREGUNTA: 'Pregunta',
  PARTICIPA: 'Participa'
}

export interface PathStep {
  id: StageId
  label: string
  state: 'done' | 'current' | 'next'
}

/** Los pasos de Backlog a Done, marcando dónde está. Backlog 2 y 3 solo si está en ellos. */
export function stagePath(status: string): PathStep[] {
  const cur = stageOf(status)
  const steps = ROAD_STAGES.filter((s) => (s.id !== 'backlog3' && s.id !== 'backlog2') || s.id === cur)
  const idx = steps.findIndex((s) => s.id === cur)
  return steps.map((s, i) => ({ id: s.id, label: s.label, state: idx === -1 ? 'next' : i < idx ? 'done' : i === idx ? 'current' : 'next' }))
}

/** Qué le toca ahora a la iniciativa para avanzar al siguiente paso. */
export function nextStepFor(i: JiraInitiative, snap: JiraSnapshot, now: Date): string {
  const stage = stageOf(i.status)
  switch (stage) {
    case 'backlog3':
    case 'backlog2':
      return 'Esperando prioridad. Si sube, pásala a Backlog para contarla en un grooming.'
    case 'backlog':
      return i.kpi
        ? `Contarla en el próximo grooming como problema nuevo, con su KPI («${i.kpi}»), y pedir voluntarios para el discovery.`
        : 'Contarla en el próximo grooming como problema nuevo y pedir voluntarios. Antes, apunta su KPI en Jira.'
    case 'discovery':
      return i.developers.length
        ? `Discovery con ${i.developers.join(' y ')}: llegar a una solución y una propuesta visual para decidir en el grooming.`
        : 'Buscar un desarrollador para el discovery: sin él no avanza.'
    case 'refine':
      return 'Llevarla al grooming como solución para decidir; con la decisión, crear sus tareas FP y pasarla a Ready to dev.'
    case 'dev': {
      const row = sprintRowFor(i, snap, now)
      return row.ready ? 'Lista para la sprint planning.' : `Antes de la sprint planning: ${row.problems.map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join('; ')}.`
    }
    case 'wip': {
      const done = i.taskKeys.filter((k) => /done|hecho|cerrad/i.test(snap.tasks.find((t) => t.key === k)?.status ?? '')).length
      return `En desarrollo: ${done} de ${i.taskKeys.length} FP hechas. Cuando acabe, pasarla a Done y decidir cuándo medir.`
    }
    case 'done':
      return 'Lanzada: medir su KPI cuando toque y dejar la conclusión en ROAD.'
    default:
      return 'Su estado no es uno de los pasos de ROAD: revísalo en Jira.'
  }
}
