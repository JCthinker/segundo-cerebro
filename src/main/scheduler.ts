import { toDay } from '@shared/dates'
import * as db from './db'
import { generateBrief } from './agent/brief'
import { markAiFailure, markAiOk } from './agent/client'
import { dataChanged } from './events'
import { getSettings } from './settings'
import { syncAllCalendars } from './sources'
import { maybeSyncJira } from './jira'

let briefRunning = false

/** Mientras la app está abierta: brief matinal, calendarios cada 30 minutos y Jira cada 3 horas. */
export function startScheduler(): void {
  void syncAllCalendars()
  setInterval(() => void syncAllCalendars(), 30 * 60_000)
  const jira = () => {
    if (getSettings().onboarded) void maybeSyncJira()
  }
  setTimeout(jira, 90_000)
  setInterval(jira, 30 * 60_000)
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
