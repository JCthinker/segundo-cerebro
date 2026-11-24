import { toDay } from '@shared/dates'
import { measureRows, type MeasurePlan, type MeasureResult, type MeasureRow } from '@shared/measure'
import { isReadOnlyTool } from '@shared/permissions'
import * as db from './db'
import { dataChanged } from './events'
import { baseSystem } from './agent/context'
import { runAgent } from './agent/client'
import { getSnapshot, jiraConnector } from './jira'

/**
 * Mediciones de lo lanzado. Claude lee el KPI de cada iniciativa terminada en ROAD y decide
 * cuándo tiene sentido medir (no es lo mismo la conversión semanal que la retención a 90 días).
 */

const PLANS = 'measure.plans'
const RESULTS = 'measure.results'

const read = <T>(key: string): T => {
  try {
    return JSON.parse(db.getSetting(key) ?? '{}') as T
  } catch {
    return {} as T
  }
}
export const measurePlans = () => read<Record<string, MeasurePlan>>(PLANS)
export const measureResults = () => read<Record<string, MeasureResult>>(RESULTS)

export function currentMeasures(): MeasureRow[] {
  return measureRows(getSnapshot(), measurePlans(), measureResults(), toDay(new Date()))
}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['plans'],
  properties: {
    plans: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'kpi', 'date', 'why'],
        properties: {
          key: { type: 'string' },
          kpi: { type: ['string', 'null'], description: 'El KPI tal como está en la iniciativa; null si no tiene' },
          date: { type: 'string', description: 'AAAA-MM-DD en que medir' },
          why: { type: 'string', description: 'Por qué esa fecha, en una frase' }
        }
      }
    }
  }
} as const

let running: Promise<number> | null = null

/** Decide con Claude cuándo medir las iniciativas terminadas que aún no tienen fecha suya. */
export function planMeasurements(): Promise<number> {
  if (!running)
    running = doPlan().finally(() => {
      running = null
      dataChanged('jira')
    })
  return running
}

async function doPlan(): Promise<number> {
  const plans = measurePlans()
  const todo = currentMeasures().filter((r) => !r.result && !plans[r.key]?.byAI)
  if (!todo.length) return 0
  const connector = await jiraConnector()
  if (!connector) throw new Error('No hay conexión de Jira para leer los KPI.')
  const r = await runAgent({
    system: baseSystem(`Para cada iniciativa terminada de Jira ROAD, lee su descripción y busca el KPI que se quería mover. Decide cuándo medir: lo que se ve en días (uso, clics, errores) a 1-2 semanas; conversión o ventas, a 3-4 semanas; retención o recurrencia, a 6-12 semanas. Cuenta desde que terminó. Usa solo herramientas de lectura.`),
    prompt: JSON.stringify(todo.map((t) => ({ clave: t.key, titulo: t.title, terminada: t.doneOn })), null, 2),
    connectors: [connector],
    canUseTool: async (toolName, input) =>
      isReadOnlyTool(toolName) ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Solo lectura.' },
    outputSchema: PLAN_SCHEMA as unknown as Record<string, unknown>,
    tier: 'quick',
    effort: 'low',
    maxTurns: 20
  })
  const out = (r.structured as { plans: { key: string; kpi: string | null; date: string; why: string }[] } | null)?.plans ?? []
  const next = { ...plans }
  for (const p of out) if (todo.some((t) => t.key === p.key) && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) next[p.key] = { date: p.date, kpi: p.kpi, why: p.why, byAI: true }
  db.setSetting(PLANS, JSON.stringify(next))
  return out.length
}

/** Para el programador: solo si hay iniciativas terminadas sin fecha de Claude. */
export async function maybePlanMeasurements(): Promise<void> {
  const plans = measurePlans()
  if (currentMeasures().some((r) => !r.result && !plans[r.key]?.byAI)) await planMeasurements().catch(() => undefined)
}

/** Cambias la fecha a mano: Claude lo tendrá en cuenta. */
export function setMeasureDate(key: string, date: string): void {
  const plans = measurePlans()
  const cur = currentMeasures().find((r) => r.key === key)
  plans[key] = { date, kpi: cur?.plan.kpi ?? null, why: 'Fecha elegida por ti.', byAI: true }
  db.setSetting(PLANS, JSON.stringify(plans))
  dataChanged('jira')
}

/** Guarda el resultado y devuelve el mensaje para que Claude lo registre en ROAD (con tu OK). */
export function recordMeasure(key: string, text: string): string {
  const results = measureResults()
  results[key] = { at: new Date().toISOString(), text: text.trim() }
  db.setSetting(RESULTS, JSON.stringify(results))
  dataChanged('jira')
  dataChanged('brief')
  const row = currentMeasures().find((r) => r.key === key)
  return `Registra en ${key}${row ? ` «${row.title}»` : ''} el resultado de la medición${row?.plan.kpi ? ` del KPI «${row.plan.kpi}»` : ''}: ${text.trim()}. Ponlo como conclusión en un comentario de la iniciativa; enséñamelo y pídeme OK antes de escribir.`
}
