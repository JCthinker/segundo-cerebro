import { randomUUID } from 'node:crypto'
import type { RoadNote } from '@shared/initiative'
import * as db from './db'

/**
 * Conclusiones de reuniones por iniciativa, para saber cuáles ya están escritas en ROAD
 * y cuáles no. Salen de «Revisar y repartir».
 */
const KEY = 'road.notes'

export function listRoadNotes(key?: string): RoadNote[] {
  let all: RoadNote[] = []
  try {
    all = JSON.parse(db.getSetting(KEY) ?? '[]') as RoadNote[]
  } catch {
    all = []
  }
  return key ? all.filter((n) => n.key.toUpperCase() === key.toUpperCase()) : all
}

export function addRoadNotes(entries: Omit<RoadNote, 'id' | 'at' | 'registered'>[]): void {
  if (!entries.length) return
  const at = new Date().toISOString()
  const next = [...listRoadNotes(), ...entries.map((e) => ({ ...e, id: randomUUID(), at, registered: false }))]
  db.setSetting(KEY, JSON.stringify(next.slice(-500)))
}

export function markRoadNote(id: string, registered: boolean): void {
  db.setSetting(KEY, JSON.stringify(listRoadNotes().map((n) => (n.id === id ? { ...n, registered } : n))))
}
