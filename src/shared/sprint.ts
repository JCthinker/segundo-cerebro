/**
 * Sprint y épicas: para cada iniciativa lista para desarrollo, si sus tareas FP están preparadas
 * y si su épica tiene exactamente las mismas tareas. Sin IA.
 */
import { quarterOf, stageOf, taskReady, type JiraSnapshot, type JiraTask } from './jira'

export interface SprintRow {
  key: string
  title: string
  url: string | null
  status: string
  quarter: string | null
  currentQuarter: boolean
  tasks: (JiraTask & { ready: boolean })[]
  /** Tareas que la iniciativa nombra pero no están en la copia de FP. */
  unknownTasks: string[]
  epic: { key: string; url: string | null; missing: string[]; extra: string[] } | null
  ready: boolean
  problems: string[]
}

const up = (s: string) => s.toUpperCase()

export function sprintRows(snap: JiraSnapshot | null, now: Date): SprintRow[] {
  if (!snap) return []
  const q = quarterOf(now).toLowerCase().replace(/\s+/g, '')
  return snap.initiatives
    .filter((i) => stageOf(i.status) === 'dev' || stageOf(i.status) === 'wip')
    .map((i) => {
      const tasks = i.taskKeys.flatMap((k) => {
        const t = snap.tasks.find((x) => up(x.key) === up(k))
        return t ? [{ ...t, ready: taskReady(t) }] : []
      })
      const unknownTasks = i.taskKeys.filter((k) => !snap.tasks.some((x) => up(x.key) === up(k)))
      const e = i.epicKey ? snap.epics.find((x) => up(x.key) === up(i.epicKey!)) : snap.epics.find((x) => x.roadKey && up(x.roadKey) === up(i.key))
      const mine = new Set(i.taskKeys.map(up))
      const inEpic = new Set((e?.taskKeys ?? []).map(up))
      const epic = e ? { key: e.key, url: e.url, missing: [...mine].filter((k) => !inEpic.has(k)), extra: [...inEpic].filter((k) => !mine.has(k)) } : null
      const problems: string[] = []
      if (!i.taskKeys.length) problems.push('No tiene tareas FP')
      const notReady = tasks.filter((t) => !t.ready).length
      if (notReady) problems.push(`${notReady} FP sin describir o estimar`)
      if (!epic) problems.push('No tiene épica')
      else {
        if (epic.missing.length) problems.push(`Faltan en la épica: ${epic.missing.join(', ')}`)
        if (epic.extra.length) problems.push(`Sobran en la épica: ${epic.extra.join(', ')}`)
      }
      return {
        key: i.key,
        title: i.title,
        url: i.url,
        status: i.status,
        quarter: i.quarter,
        currentQuarter: !!i.quarter && i.quarter.toLowerCase().replace(/\s+/g, '') === q,
        tasks,
        unknownTasks,
        epic,
        ready: !problems.length,
        problems
      }
    })
    .sort((a, b) => Number(b.currentQuarter) - Number(a.currentQuarter) || Number(a.ready) - Number(b.ready) || a.key.localeCompare(b.key))
}

/** Objetivo de sprint propuesto: las iniciativas del trimestre que ya están listas. */
export function sprintGoal(rows: SprintRow[]): string {
  const now = rows.filter((r) => r.currentQuarter && r.status.toLowerCase().includes('dev'))
  const ready = now.filter((r) => r.ready)
  if (!rows.length) return 'No hay iniciativas en Ready to dev: no hay nada que llevar a la sprint planning.'
  if (!now.length) return 'Ninguna iniciativa en Ready to dev es de este trimestre: revisa prioridades antes de la sprint planning.'
  if (!ready.length) return `Objetivo posible: ${now.map((r) => `«${r.title}»`).join(' y ')}, pero aún les falta preparación.`
  return `Objetivo posible: avanzar ${ready.map((r) => `«${r.title}»`).join(' y ')}, del trimestre y listas.`
}
