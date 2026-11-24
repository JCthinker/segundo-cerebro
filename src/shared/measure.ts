/**
 * Mediciones: cuándo medir si una iniciativa lanzada cumple su KPI. La fecha la decide Claude
 * según el tipo de KPI; mientras no lo haya hecho, se propone a las dos semanas de terminar.
 */
import { stageOf, type JiraSnapshot } from './jira'

export interface MeasurePlan {
  /** Día (AAAA-MM-DD) en que conviene medir. */
  date: string
  kpi: string | null
  why: string
  byAI: boolean
}

export interface MeasureResult {
  at: string
  text: string
}

export interface MeasureRow {
  key: string
  title: string
  url: string | null
  doneOn: string | null
  plan: MeasurePlan
  result: MeasureResult | null
  due: boolean
}

const addDaysIso = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Iniciativas terminadas en los últimos 4 meses, con su plan de medición. */
export function measureRows(
  snap: JiraSnapshot | null,
  plans: Record<string, MeasurePlan>,
  results: Record<string, MeasureResult>,
  today: string
): MeasureRow[] {
  if (!snap) return []
  const since = addDaysIso(today, -120)
  return snap.initiatives
    .filter((i) => stageOf(i.status) === 'done' && (!i.updated || i.updated.slice(0, 10) >= since))
    .map((i) => {
      const doneOn = i.updated ? i.updated.slice(0, 10) : null
      const plan = plans[i.key] ?? { date: addDaysIso(doneOn ?? today, 14), kpi: i.kpi ?? null, why: 'Dos semanas después de terminar, hasta que Claude lea el KPI.', byAI: false }
      const result = results[i.key] ?? null
      return { key: i.key, title: i.title, url: i.url, doneOn, plan, result, due: !result && plan.date <= today }
    })
    .sort((a, b) => Number(!!a.result) - Number(!!b.result) || a.plan.date.localeCompare(b.plan.date))
}
