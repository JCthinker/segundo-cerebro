import type { ActionRun, Item } from './types'
import { toDay } from './dates'

/**
 * Qué pasó con cada cosa:
 * - done: la marcaste como hecha · dismissed: la descartaste
 * - claude: Claude la resolvió (o sigue trabajando) · planned: Claude preparó el plan y no se lanzó
 * - rejected: dijiste que no a una acción de Claude · failed: Claude empezó y no terminó
 */
export type HistoryKind = 'done' | 'dismissed' | 'claude' | 'planned' | 'rejected' | 'failed'

export interface HistoryEntry {
  id: string
  kind: HistoryKind
  at: string // ISO
  title: string
  /** Lo que conviene ver al abrirlo: el resumen de Claude, el plan, el motivo… */
  detail: string | null
  steps?: string[]
  itemId: string | null
  runId: string | null
  /** En «rejected»: la acción que rechazaste. */
  toolName?: string
  input?: unknown
  /** En «claude»: true mientras sigue trabajando. */
  running?: boolean
  /** En «claude»: cuántas cosas quedaron en borrador. */
  drafts?: number
}

export interface HistoryDay {
  date: string // YYYY-MM-DD
  entries: HistoryEntry[]
}

const lastOf = (run: ActionRun, type: string) => [...run.log].reverse().find((e) => e.type === type)

function fromRun(run: ActionRun): HistoryEntry[] {
  const base = { title: run.goal, itemId: run.itemId, runId: run.id }
  const plan = lastOf(run, 'plan')
  const out: HistoryEntry[] = []
  if (run.status === 'planned') {
    out.push({ ...base, id: `${run.id}:plan`, kind: 'planned', at: plan?.at ?? run.createdAt, detail: plan?.text ?? null, steps: plan?.steps })
    return out
  }
  // Cada «no» tuyo queda apuntado aparte, con la acción concreta.
  run.log.forEach((e, i) => {
    if (e.type === 'denied' && (e.byUser || e.text.endsWith('rechazado por ti')))
      out.push({ ...base, id: `${run.id}:no${i}`, kind: 'rejected', at: e.at, detail: null, toolName: e.toolName, input: e.input })
  })
  const end = run.log.at(-1)?.at ?? run.createdAt
  if (run.status === 'done' || run.status === 'running') {
    out.push({
      ...base,
      id: run.id,
      kind: 'claude',
      at: run.status === 'running' ? run.createdAt : end,
      detail: lastOf(run, 'result')?.text ?? null,
      running: run.status === 'running',
      drafts: run.log.filter((e) => e.type === 'draft').length
    })
  } else {
    const err = lastOf(run, 'error')
    out.push({
      ...base,
      id: run.id,
      kind: 'failed',
      at: end,
      detail: run.status === 'error' ? (err?.text ?? 'Algo falló.') : 'Se detuvo antes de terminar.'
    })
  }
  return out
}

function fromItem(item: Item): HistoryEntry | null {
  const base = { id: item.id, title: item.title, itemId: item.id, runId: null }
  if (item.status === 'done') return { ...base, kind: 'done', at: item.doneAt ?? item.updatedAt, detail: item.context ?? null }
  if (item.status === 'dismissed') return { ...base, kind: 'dismissed', at: item.updatedAt, detail: item.dismissReason ?? null }
  return null
}

/** Todo lo que ha pasado, agrupado por días (lo más reciente primero). */
export function buildHistory(items: Item[], runs: ActionRun[]): HistoryDay[] {
  const entries = [...items.map(fromItem).filter((e): e is HistoryEntry => !!e), ...runs.flatMap(fromRun)].sort((a, b) =>
    b.at.localeCompare(a.at)
  )
  const days: HistoryDay[] = []
  for (const e of entries) {
    const date = toDay(new Date(e.at))
    const day = days.at(-1)
    if (day?.date === date) day.entries.push(e)
    else days.push({ date, entries: [e] })
  }
  return days
}

/** El título de un encargo a Claude: lo primero que le pediste, sin el texto que añade la app. */
export function requestTitle(goal: string): string {
  const first =
    goal
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.endsWith(':'))
      .map((l) => l.replace(/^[-*]\s+/, ''))[0] ?? ''
  return first.length > 120 ? `${first.slice(0, 117)}…` : first || 'Encargo a Claude'
}
