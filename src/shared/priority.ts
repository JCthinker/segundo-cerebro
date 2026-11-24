import type { Area, Item, ScoredItem } from './types'
import { diffDays } from './dates'

/**
 * Puntuación explicable. Cada punto que se suma deja un motivo legible,
 * para que la interfaz pueda decir por qué algo está arriba.
 *
 *  - compromiso: una promesa a otra persona pesa más que una tarea propia
 *  - urgencia: días hasta (fecha límite − margen de preparación)
 *  - importancia: multiplicador por el peso del área
 */
export function scoreItem(item: Item, today: string, areas: Area[]): ScoredItem {
  const reasons: string[] = []
  let score = 0

  switch (item.kind) {
    case 'promise':
      if (item.person) {
        score += 30
        reasons.push(`Encargo de ${item.person}`)
      } else {
        score += 20
        reasons.push('Es un encargo')
      }
      break
    case 'deadline':
      score += 15
      reasons.push('Es una entrega')
      break
    case 'task':
      score += 5
      break
    case 'decision':
      break
  }

  let daysToDue: number | null = null
  let mustStart = false
  let overdue = false

  if (item.dueDate) {
    daysToDue = diffDays(today, item.dueDate)
    const daysToStart = daysToDue - Math.max(0, item.prepDays)
    if (daysToDue < 0) {
      overdue = true
      score += 50
      reasons.push(daysToDue === -1 ? 'Venció ayer' : `Atrasada ${-daysToDue} días`)
    } else if (daysToDue === 0) {
      score += 45
      reasons.push('Vence hoy')
    } else if (daysToDue === 1) {
      score += 35
      reasons.push('Vence mañana')
    } else if (daysToStart <= 0) {
      mustStart = true
      score += 40
      reasons.push(`Necesita ${item.prepDays} días de preparación: hay que empezar ya`)
    } else {
      const u = Math.max(0, 30 - 3 * daysToStart)
      score += u
      if (item.prepDays > 0 && daysToStart <= 7) {
        reasons.push(`Hay que empezar en ${daysToStart === 1 ? '1 día' : `${daysToStart} días`} (necesita ${item.prepDays} de preparación)`)
      } else if (daysToDue <= 7) reasons.push(`Vence en ${daysToDue} días`)
    }
  }

  const area = item.areaId ? areas.find((a) => a.id === item.areaId) : undefined
  if (area && area.weight !== 1) {
    score *= area.weight
    reasons.push(
      area.weight > 1
        ? `Área ${area.name} (×${round1(area.weight)})`
        : `Área ${area.name} con menos peso (×${round1(area.weight)})`
    )
  }

  const atRisk = item.kind === 'promise' && (overdue || mustStart || (daysToDue !== null && daysToDue <= 1))

  return { item, score: Math.round(score * 10) / 10, reasons, atRisk, daysToDue }
}

export function rankItems(items: Item[], today: string, areas: Area[]): ScoredItem[] {
  return items
    .filter((i) => i.status === 'active' && i.kind !== 'decision')
    .map((i) => scoreItem(i, today, areas))
    .sort((a, b) => b.score - a.score || (a.daysToDue ?? 9999) - (b.daysToDue ?? 9999))
}

/** Lo que se puede aplazar: baja puntuación, sin persona esperando y sin fecha cercana. */
export function letGoCandidates(ranked: ScoredItem[], max = 3): ScoredItem[] {
  return ranked
    .slice(3)
    .filter((s) => s.item.kind !== 'promise' && (s.daysToDue === null || s.daysToDue > 3))
    .slice(-max)
    .reverse()
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace('.', ',')
}
