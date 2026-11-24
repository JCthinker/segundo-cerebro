import { toDay } from '@shared/dates'
import * as db from './db'
import { generateBrief } from './agent/brief'
import { markAiFailure, markAiOk } from './agent/client'
import { dataChanged } from './events'
import { getSettings } from './settings'
import { syncAllCalendars } from './sources'
import { maybeSyncJira } from './jira'
import { maybePlanMeasurements } from './measure'
import { maybeReviewNews } from './novedades'

let briefRunning = false

/** Mientras la app está abierta: brief matinal, calendarios cada 30 minutos, novedades cada 2 horas y Jira cada 3. */
export function startScheduler(): void {
  void syncAllCalendars()
  setInterval(() => void syncAllCalendars(), 30 * 60_000)
  const jira = () => {
    if (getSettings().onboarded) void maybeSyncJira().then(() => maybePlanMeasurements())
  }
  setTimeout(jira, 90_000)
  setInterval(jira, 30 * 60_000)
  // Novedades: el modelo barato lee lo nuevo cada 2 horas, solo en horario de trabajo.
  const news = () => {
    const h = new Date().getHours()
    if (getSettings().onboarded && h >= 8 && h < 20) void maybeReviewNews()
  }
  setTimeout(news, 4 * 60_000)
  setInterval(news, 30 * 60_000)
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
