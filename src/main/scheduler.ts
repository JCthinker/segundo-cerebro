import { toDay } from '@shared/dates'
import * as db from './db'
import { generateBrief } from './agent/brief'
import { markAiFailure, markAiOk } from './agent/client'
import { dataChanged } from './events'
import { getSettings } from './settings'
import { syncAllCalendars } from './sources'

let briefRunning = false

/** Mientras la app está abierta: brief matinal a la hora elegida y calendarios cada 30 minutos. */
export function startScheduler(): void {
  void syncAllCalendars()
  setInterval(() => void syncAllCalendars(), 30 * 60_000)
  setInterval(() => void maybeMorningBrief(), 5 * 60_000)
  setTimeout(() => void maybeMorningBrief(), 20_000)
}

async function maybeMorningBrief(): Promise<void> {
  const s = getSettings()
  if (!s.onboarded || s.briefHour < 0 || briefRunning) return
  const now = new Date()
  if (now.getHours() < s.briefHour) return
  const existing = db.getBrief(toDay(now))
  if (existing?.byAI) return
  briefRunning = true
  try {
    await generateBrief(true)
    markAiOk()
    dataChanged('brief')
  } catch (e) {
    markAiFailure(e)
  } finally {
    briefRunning = false
  }
}
