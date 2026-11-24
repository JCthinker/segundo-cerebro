/**
 * Jira visto por la app: una copia de las iniciativas de ROAD y las tareas y épicas de FP.
 * Aquí solo hay cálculos (sin IA): en qué paso está cada iniciativa y qué le falta.
 */

export interface JiraInitiative {
  key: string
  title: string
  status: string
  /** Campo Quarter, p. ej. «Q1 - 2027». */
  quarter: string | null
  url: string | null
  /** Desarrolladores que participan (responsable o personas asignadas). */
  developers: string[]
  /** Tareas FP relacionadas con esta iniciativa. */
  taskKeys: string[]
  /** Épica de FP que replica esta iniciativa. */
  epicKey: string | null
  updated: string | null
}

export interface JiraTask {
  key: string
  title: string
  status: string
  url: string | null
  hasDescription: boolean
  estimated: boolean
  epicKey: string | null
  sprint: string | null
}

export interface JiraEpic {
  key: string
  title: string
  url: string | null
  roadKey: string | null
  taskKeys: string[]
}

export interface JiraSnapshot {
  at: string
  initiatives: JiraInitiative[]
  tasks: JiraTask[]
  epics: JiraEpic[]
}

export type StageId = 'backlog3' | 'backlog2' | 'backlog' | 'discovery' | 'refine' | 'dev' | 'wip' | 'done' | 'other'

/** Los pasos de ROAD, en orden, tal como se llaman en Jira. */
export const ROAD_STAGES: { id: StageId; label: string; status: string }[] = [
  { id: 'backlog3', label: 'Backlog 3', status: 'backlog 3' },
  { id: 'backlog2', label: 'Backlog 2', status: 'backlog 2' },
  { id: 'backlog', label: 'Backlog', status: 'backlog' },
  { id: 'discovery', label: 'Discovery', status: 'discovery' },
  { id: 'refine', label: 'Ready to refine', status: 'ready to refine' },
  { id: 'dev', label: 'Ready to dev', status: 'ready to dev' },
  { id: 'wip', label: 'WIP', status: 'wip' },
  { id: 'done', label: 'Done', status: 'done' }
]

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export function stageOf(status: string): StageId {
  const s = norm(status)
  const exact = ROAD_STAGES.find((st) => st.status === s)
  if (exact) return exact.id
  if (s === 'in progress' || s === 'en curso') return 'wip'
  return 'other'
}

/** Trimestre en el formato de ROAD: «Q4 - 2026». */
export function quarterOf(date: Date): string {
  return `Q${Math.floor(date.getMonth() / 3) + 1} - ${date.getFullYear()}`
}

export function nextQuarter(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth() + 3, 1)
  return quarterOf(d)
}

function sameQuarter(a: string | null, b: string): boolean {
  return !!a && norm(a) === norm(b)
}

/** Una FP está lista para el sprint si está descrita y estimada. */
export function taskReady(t: JiraTask): boolean {
  return t.hasDescription && t.estimated
}

export interface Warning {
  text: string
  tone: 'danger' | 'warning' | 'info'
}

/** Lo que le falta a una iniciativa según el paso en el que está. */
export function warningsFor(i: JiraInitiative, snap: JiraSnapshot): Warning[] {
  const stage = stageOf(i.status)
  const out: Warning[] = []
  const tasks = i.taskKeys.map((k) => snap.tasks.find((t) => t.key === k)).filter((t): t is JiraTask => !!t)

  if (stage === 'discovery' && !i.developers.length) out.push({ text: 'Discovery sin desarrollador', tone: 'danger' })

  if (stage === 'dev' || stage === 'wip') {
    if (!i.taskKeys.length) out.push({ text: 'Sin tareas FP', tone: 'danger' })
    const notReady = tasks.filter((t) => !taskReady(t)).length
    if (notReady) out.push({ text: notReady === 1 ? '1 FP sin preparar' : `${notReady} FP sin preparar`, tone: 'warning' })
    const epic = i.epicKey ? snap.epics.find((e) => e.key === i.epicKey) : snap.epics.find((e) => e.roadKey === i.key)
    if (!epic) out.push({ text: 'Sin épica', tone: 'warning' })
    else if (!sameSet(epic.taskKeys, i.taskKeys)) out.push({ text: 'La épica no cuadra', tone: 'warning' })
  }
  return out
}

function sameSet(a: string[], b: string[]): boolean {
  const A = new Set(a.map((x) => x.toUpperCase()))
  const B = new Set(b.map((x) => x.toUpperCase()))
  return A.size === B.size && [...A].every((x) => B.has(x))
}

export interface BoardCard extends JiraInitiative {
  stage: StageId
  warnings: Warning[]
  /** 0 = trimestre actual, 1 = el siguiente, 2 = otro o sin trimestre. */
  quarterRank: number
  tasksDone: number
}

export interface BoardColumn {
  id: StageId
  label: string
  cards: BoardCard[]
}

/** Las iniciativas repartidas por paso; dentro de cada uno, primero las del trimestre actual. */
export function buildBoard(snap: JiraSnapshot, today: Date): BoardColumn[] {
  const cur = quarterOf(today)
  const next = nextQuarter(today)
  const cards: BoardCard[] = snap.initiatives.map((i) => ({
    ...i,
    stage: stageOf(i.status),
    warnings: warningsFor(i, snap),
    quarterRank: sameQuarter(i.quarter, cur) ? 0 : sameQuarter(i.quarter, next) ? 1 : 2,
    tasksDone: i.taskKeys.filter((k) => /^(done|hecho|cerrad|closed)/i.test(snap.tasks.find((t) => t.key === k)?.status ?? '')).length
  }))
  const columns: BoardColumn[] = ROAD_STAGES.map((st) => ({ id: st.id, label: st.label, cards: [] }))
  const other: BoardColumn = { id: 'other', label: 'Otro estado', cards: [] }
  for (const c of cards) (columns.find((col) => col.id === c.stage) ?? other).cards.push(c)
  for (const col of [...columns, other]) {
    col.cards.sort((a, b) => a.quarterRank - b.quarterRank || b.warnings.length - a.warnings.length || a.key.localeCompare(b.key))
  }
  return other.cards.length ? [...columns, other] : columns
}

/** Cuándo se leyó Jira, en llano: «hace 5 min», «hace 2 h», «hace 3 días». */
export function readAgo(iso: string, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000))
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ayer' : `hace ${d} días`
}

/** Busca por clave o título, sin tildes ni mayúsculas. */
export function matches(text: string, query: string): boolean {
  const q = norm(query)
  return !q || norm(text).includes(q)
}
