import { useState } from 'react'
import type { Item } from '@shared/types'
import type { HistoryDay, HistoryEntry, HistoryKind } from '@shared/history'
import { formatDayLong, formatRelative, toDay } from '@shared/dates'
import { serverLabel, serverOf } from '@shared/permissions'
import { call, useData } from '../api'
import { ToolInput, toolAction } from '../components/ApprovalHost'
import { Markdown } from '../components/Markdown'
import { Button, Empty, ErrorNote, Icon, PageHeader, Pill } from '../components/ui'
import { useNav } from '../nav'

type Tone = Parameters<typeof Pill>[0]['tone']

const KIND: Record<HistoryKind, { label: string; tone: Tone; icon: Parameters<typeof Icon>[0]['name'] }> = {
  done: { label: 'Hecho por ti', tone: 'success', icon: 'check' },
  claude: { label: 'Hecho por Claude', tone: 'clay', icon: 'sparkles' },
  planned: { label: 'Pedido, sin lanzar', tone: 'warning', icon: 'hand' },
  rejected: { label: 'Rechazado por ti', tone: 'danger', icon: 'x' },
  dismissed: { label: 'Descartado', tone: 'neutral', icon: 'trash' },
  failed: { label: 'Falló o se detuvo', tone: 'danger', icon: 'x' }
}

const FILTERS: { id: string; label: string; kinds: HistoryKind[] | null }[] = [
  { id: 'all', label: 'Todo', kinds: null },
  { id: 'me', label: 'Lo que hice yo', kinds: ['done', 'dismissed', 'rejected'] },
  { id: 'claude', label: 'Lo que hizo Claude', kinds: ['claude'] },
  { id: 'open', label: 'Lo que quedó sin hacer', kinds: ['planned', 'rejected', 'failed'] }
]

const time = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })

/** La acción concreta que rechazaste, en llano: «Enviar un mensaje en Slack». */
function rejectedAction(e: HistoryEntry): string | null {
  if (!e.toolName) return null
  const server = serverOf(e.toolName)
  return `${toolAction(e.toolName).verb} en ${server ? serverLabel(server) : 'Claude'}`
}

export function History() {
  const { data: days, error } = useData<HistoryDay[]>('history.get', [], ['items', 'runs'])
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState<string | null>(null)
  const today = toDay(new Date())

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!days) return null
  const kinds = FILTERS.find((f) => f.id === filter)?.kinds
  const shown = days.map((d) => ({ ...d, entries: d.entries.filter((e) => !kinds || kinds.includes(e.kind)) })).filter((d) => d.entries.length)

  return (
    <div>
      <PageHeader title="Historial" subtitle="Todo lo que has cerrado, lo que has pedido a Claude y qué pasó con cada cosa." />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-3 py-1 text-[12.5px] ${filter === f.id ? 'border-ink bg-ink text-page' : 'border-line-strong text-muted hover:text-ink'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!shown.length ? (
        <Empty title={days.length ? 'Nada en este filtro' : 'Todavía no hay historial'}>
          {days.length ? 'Prueba con «Todo».' : 'Aquí irá apareciendo lo que completes, descartes o pidas a Claude.'}
        </Empty>
      ) : (
        <div className="space-y-6">
          {shown.map((d) => (
            <section key={d.date}>
              <h2 className="mb-2 text-[13px] font-medium text-muted first-letter:uppercase">
                {d.date === today || formatRelative(today, d.date) === 'ayer' ? `${formatRelative(today, d.date)} · ` : ''}
                {formatDayLong(d.date)}
              </h2>
              <div className="rounded-xl border border-line bg-raised">
                {d.entries.map((e) => (
                  <Row key={e.id} e={e} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function Row({ e, open, onToggle }: { e: HistoryEntry; open: boolean; onToggle: () => void }) {
  const k = KIND[e.kind]
  const action = e.kind === 'rejected' ? rejectedAction(e) : null
  const label = e.kind === 'claude' && e.running ? 'Claude trabajando' : k.label
  return (
    <div className="border-b border-line last:border-0">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover">
        <span className="w-11 shrink-0 text-[12px] text-faint">{time(e.at)}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[14px] ${e.kind === 'dismissed' ? 'text-muted line-through' : ''}`}>{e.title}</span>
          {action ? <span className="block truncate text-[12.5px] text-muted">No dejaste: {action.charAt(0).toLowerCase() + action.slice(1)}</span> : null}
          {e.kind === 'dismissed' && e.detail ? <span className="block truncate text-[12.5px] text-muted">Motivo: {e.detail}</span> : null}
        </span>
        {e.drafts ? <Pill tone="info">{e.drafts === 1 ? '1 borrador' : `${e.drafts} borradores`}</Pill> : null}
        <Pill tone={k.tone}>
          <Icon name={k.icon} className="h-3 w-3" /> {label}
        </Pill>
        <Icon name="chevron" className={`h-3.5 w-3.5 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open ? <Detail e={e} /> : null}
    </div>
  )
}

function Detail({ e }: { e: HistoryEntry }) {
  const { resolve } = useNav()
  /** Vuelve a abrir el encargo con Claude, sobre la misma tarea si la hay. */
  const retry = async () => {
    const item = e.itemId ? await call<Item | null>('items.get', e.itemId) : null
    resolve(item, item ? undefined : e.title)
  }
  const canRetry = e.kind === 'planned' || e.kind === 'failed' || e.kind === 'rejected'
  return (
    <div className="space-y-3 px-4 pb-4 pl-[4.25rem] text-[13.5px]">
      {e.kind === 'planned' ? (
        <>
          <p className="text-muted">Claude preparó este plan, pero no se llegó a lanzar. No se hizo nada.</p>
          {e.detail ? <p className="font-voice text-[15px]">{e.detail}</p> : null}
          {e.steps?.length ? (
            <ol className="list-decimal space-y-0.5 pl-5 text-muted">
              {e.steps.map((st, i) => (
                <li key={i}>{st}</li>
              ))}
            </ol>
          ) : null}
        </>
      ) : null}
      {e.kind === 'claude' ? (
        e.running ? (
          <p className="text-muted">Claude sigue trabajando en esto.</p>
        ) : e.detail ? (
          <div className="font-voice text-[15px] leading-relaxed">
            <Markdown text={e.detail} />
          </div>
        ) : (
          <p className="text-muted">Terminó sin dejar resumen.</p>
        )
      ) : null}
      {e.kind === 'rejected' ? (
        <>
          <p className="text-muted">Claude te pidió permiso para esto y le dijiste que no, así que no se hizo:</p>
          <ToolInput input={e.input} />
        </>
      ) : null}
      {e.kind === 'failed' ? <p className="text-muted">{e.detail}</p> : null}
      {e.kind === 'done' ? <p className="text-muted">{e.detail || 'La marcaste como hecha.'}</p> : null}
      {e.kind === 'dismissed' ? <p className="text-muted">{e.detail ? `La descartaste porque: ${e.detail}` : 'La descartaste sin dar motivo.'}</p> : null}
      {canRetry ? (
        <Button size="sm" variant="claude" onClick={() => void retry()}>
          <Icon name="sparkles" /> Volver a pedírselo a Claude
        </Button>
      ) : null}
    </div>
  )
}
