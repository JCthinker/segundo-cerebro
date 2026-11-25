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
  /** KPI que se quiere mover, si aparece en la iniciativa (copias antiguas no lo tienen). */
  kpi?: string | null
  /** Valor del campo por el que eliges ordenar, tal como lo muestra Jira. */
  sortValue?: string | null
  /** Puesto que le da Jira al ordenar por ese campo (0 = la primera). */
  position?: number
  /** Valor del campo de Jira que elegiste para las columnas (solo con «Otro campo de Jira»). */
  groupValue?: string | null
  /** El estado tal como está en Jira, antes de traducirlo a un paso de ROAD. */
  rawStatus?: string
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
  /** Campo de Jira por el que se leyeron ordenadas las iniciativas (vacío: orden de la app). */
  sortField?: string
  sortDesc?: boolean
  /** Campo de Jira cuyo valor se leyó en «groupValue». */
  groupField?: string
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

/** Orden de la app: primero el trimestre actual, luego las que tienen más avisos. */
function appOrder(a: BoardCard, b: BoardCard): number {
  return a.quarterRank - b.quarterRank || b.warnings.length - a.warnings.length || a.key.localeCompare(b.key)
}

/** Si elegiste un campo, el orden en que lo devolvió Jira; si no, el de la app. */
export function cardOrder(snap: JiraSnapshot): (a: BoardCard, b: BoardCard) => number {
  if (!snap.sortField) return appOrder
  const pos = (c: BoardCard) => c.position ?? Number.MAX_SAFE_INTEGER
  return (a, b) => pos(a) - pos(b) || appOrder(a, b)
}

/** Las iniciativas repartidas por paso; dentro de cada uno, por el campo que elegiste (o primero las del trimestre actual). */
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
    col.cards.sort(cardOrder(snap))
  }
  return other.cards.length ? [...columns, other] : columns
}

/** Todas las iniciativas en una sola lista, sin agrupar por paso, en el orden elegido. */
export function boardList(snap: JiraSnapshot, board: { cards: BoardCard[] }[]): BoardCard[] {
  return board.flatMap((c) => c.cards).sort(cardOrder(snap))
}

/** Pone a cada iniciativa el puesto en que llegó de Jira. */
export function withPositions(snap: JiraSnapshot): JiraSnapshot {
  return { ...snap, initiatives: snap.initiatives.map((i, n) => ({ ...i, position: n })) }
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

/** Cómo quieres ver Jira. */
export interface JiraPrefs {
  road: string
  fp: string
  /** Condición JQL extra para leer solo lo tuyo (p. ej. «team = Pagos»). */
  filter: string
  /** Columnas del tablero que no quieres ver (antiguo: solo pasos de ROAD). */
  hidden: StageId[]
  /** Con qué criterio se reparten las iniciativas en columnas. */
  groupBy: GroupBy
  /** Campo de Jira para las columnas cuando eliges «Otro campo de Jira». */
  groupField: string
  /** Columnas que no quieres ver, por criterio: { status: ['Backlog 3'] }. */
  hiddenCols: Partial<Record<GroupBy, string[]>>
  /** Estados con otro nombre en tu Jira → paso de ROAD («En curso» → WIP). */
  aliases: Record<string, StageId>
  /** Campo de Jira por el que ordenar las iniciativas («Prioridad», «Rank»…). Vacío: orden de la app. */
  sortField: string
  /** De mayor a menor (o de la Z a la A). */
  sortDesc: boolean
  /** Cómo ver las iniciativas: tablero por pasos o una sola lista. */
  view: 'board' | 'list'
}

export const DEFAULT_PREFS: JiraPrefs = { road: 'ROAD', fp: 'FP', filter: '', hidden: [], aliases: {}, groupBy: 'status', groupField: '', hiddenCols: {}, sortField: '', sortDesc: false, view: 'board' }

const aliasKey = (s: string) => norm(s)

/** Cambia los estados con otro nombre por el nombre del paso, para que todo lo demás los entienda. */
export function applyAliases(snap: JiraSnapshot, aliases: Record<string, StageId>): JiraSnapshot {
  const map = new Map(Object.entries(aliases).map(([k, v]) => [aliasKey(k), v]))
  if (!map.size) return snap
  return {
    ...snap,
    initiatives: snap.initiatives.map((i) => {
      const to = map.get(aliasKey(i.status))
      const label = to && ROAD_STAGES.find((s) => s.id === to)?.label
      return label ? { ...i, rawStatus: i.rawStatus ?? i.status, status: label } : i
    })
  }
}

/** Estados de las iniciativas que la app no reconoce como un paso de ROAD. */
export function unknownStatuses(snap: JiraSnapshot | null): string[] {
  if (!snap) return []
  return [...new Set(snap.initiatives.filter((i) => stageOf(i.status) === 'other').map((i) => i.status))]
}

/** Criterios para repartir las iniciativas en columnas. */
export type GroupBy = 'status' | 'stage' | 'quarter' | 'developer' | 'field'

export const GROUP_OPTIONS: { id: GroupBy; label: string }[] = [
  { id: 'status', label: 'Status de Jira' },
  { id: 'stage', label: 'Paso de producto' },
  { id: 'quarter', label: 'Trimestre' },
  { id: 'developer', label: 'Desarrollador' },
  { id: 'field', label: 'Otro campo de Jira' }
]

export interface GroupColumn {
  /** El valor del criterio (también es su nombre). */
  id: string
  label: string
  cards: BoardCard[]
}

const NONE: Record<GroupBy, string> = { status: 'Sin status', stage: 'Otro estado', quarter: 'Sin trimestre', developer: 'Sin desarrollador', field: 'Sin valor' }

/** Columnas en las que cae una iniciativa con ese criterio (con desarrollador puede ir en varias). */
function valuesOf(c: BoardCard, by: GroupBy): string[] {
  const clean = (v: string | null | undefined) => (v ?? '').trim()
  if (by === 'status') return [clean(c.rawStatus ?? c.status)]
  if (by === 'stage') return [ROAD_STAGES.find((s) => s.id === c.stage)?.label ?? '']
  if (by === 'quarter') return [clean(c.quarter)]
  if (by === 'developer') return c.developers.length ? c.developers.map(clean) : ['']
  return [clean(c.groupValue)]
}

/** Orden de las columnas: los pasos de ROAD en su orden, trimestres por fecha, el resto alfabético; «sin valor» al final. */
function columnRank(label: string, by: GroupBy): [number, number, string] {
  if (label === NONE[by]) return [2, 0, '']
  const stage = ROAD_STAGES.findIndex((s) => s.status === norm(label))
  if ((by === 'status' || by === 'stage' || by === 'field') && stage >= 0) return [0, stage, '']
  const q = /q\s*([1-4])\D+(\d{4})/i.exec(label)
  if (by === 'quarter' && q) return [0, Number(q[2]) * 10 + Number(q[1]), '']
  return [1, 0, norm(label)]
}

/** Las iniciativas repartidas en columnas según el criterio que elijas; cada columna, en el orden elegido. */
export function groupBoard(snap: JiraSnapshot, today: Date, by: GroupBy): GroupColumn[] {
  const cards = buildBoard(snap, today).flatMap((c) => c.cards)
  const cols = new Map<string, GroupColumn>()
  if (by === 'stage') for (const s of ROAD_STAGES) cols.set(s.label, { id: s.label, label: s.label, cards: [] })
  for (const c of cards) {
    for (const v of new Set(valuesOf(c, by).map((x) => x || NONE[by]))) {
      if (!cols.has(v)) cols.set(v, { id: v, label: v, cards: [] })
      cols.get(v)!.cards.push(c)
    }
  }
  const order = cardOrder(snap)
  const out = [...cols.values()]
  for (const col of out) col.cards.sort(order)
  return out.sort((a, b) => {
    const [x1, y1, z1] = columnRank(a.label, by)
    const [x2, y2, z2] = columnRank(b.label, by)
    return x1 - x2 || y1 - y2 || z1.localeCompare(z2, 'es')
  })
}

/** Columnas ocultas para ese criterio. Con pasos, por defecto se ocultan Backlog 2 y 3 (como antes). */
export function hiddenColumns(p: JiraPrefs, by: GroupBy): string[] {
  const saved = p.hiddenCols?.[by]
  if (saved) return saved
  if (by === 'stage') {
    const ids: StageId[] = p.hidden?.length ? p.hidden : ['backlog3', 'backlog2']
    return ROAD_STAGES.filter((s) => ids.includes(s.id)).map((s) => s.label)
  }
  return []
}
