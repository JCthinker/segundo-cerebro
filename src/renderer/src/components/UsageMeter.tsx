import { useEffect, useState } from 'react'
import type { ClaudeUsage } from '@shared/types'
import { call } from '../api'

const resetLabel = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const mins = Math.round((d.getTime() - Date.now()) / 60_000)
  if (mins <= 0) return ''
  if (mins < 60) return `se reinicia en ${mins} min`
  if (mins < 24 * 60) return `se reinicia en ${Math.round(mins / 60)} h`
  return `se reinicia el ${d.toLocaleDateString('es-ES', { weekday: 'long' })}`
}

/** Consumo de tu plan de Claude: cuánto llevas de las últimas 5 horas y de la semana. */
export function UsageMeter() {
  const [u, setU] = useState<ClaudeUsage | null>(null)
  useEffect(() => {
    const load = (refresh: boolean) => void call<ClaudeUsage>('ai.usage', refresh).then(setU).catch(() => undefined)
    load(false)
    const t = setInterval(() => load(true), 5 * 60_000)
    return () => clearInterval(t)
  }, [])
  if (!u?.available) return null
  return (
    <div className="space-y-1.5 px-2.5 pt-2" title={u.plan ? `Plan ${u.plan}` : undefined}>
      {u.windows.slice(0, 3).map((w) => (
        <div key={w.label} title={resetLabel(w.resetsAt) || undefined}>
          <div className="flex text-[11px] text-faint">
            <span className="flex-1 truncate">{w.label}</span>
            <span className="tabular-nums">{w.percent}%</span>
          </div>
          <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-hover">
            <div
              className={`h-full rounded-full ${w.percent >= 90 ? 'bg-danger' : w.percent >= 70 ? 'bg-warning' : 'bg-clay'}`}
              style={{ width: `${Math.min(100, Math.max(2, w.percent))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
