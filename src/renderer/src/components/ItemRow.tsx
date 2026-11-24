import type { Area, Item, ScoredItem } from '@shared/types'
import { formatRelative } from '@shared/dates'
import { toolFromRef } from '@shared/dedupe'
import { call } from '../api'
import { useNav } from '../nav'
import { Button, Icon, Pill } from './ui'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function DuePill({ item, atRisk }: { item: Item; atRisk?: boolean }) {
  if (!item.dueDate) return null
  const t = today()
  const rel = formatRelative(t, item.dueDate)
  const overdue = item.dueDate < t
  const soon = item.dueDate <= t || rel === 'mañana'
  const tone = overdue || atRisk ? 'danger' : soon ? 'warning' : 'neutral'
  return <Pill tone={tone}>{overdue ? `Atrasada · ${rel}` : atRisk ? `En riesgo · ${rel}` : rel}</Pill>
}

export function SourceLine({ item }: { item: Item }) {
  const { go } = useNav()
  if (!item.sourceSnippet && !item.sourceRef) return null
  const label: Record<Item['sourceType'], string> = {
    note: 'Nota', capture: 'Captura', calendar: 'Calendario', file: 'Archivo', transcript: 'Acta', mcp: '', manual: 'Manual'
  }
  // De una herramienta: su nombre (o nombres, si son varias: «Slack, Jira»).
  // Si no se sabe, no se inventa una etiqueta genérica: se enseña el origen tal cual.
  const name = item.sourceType === 'mcp' ? item.sourceTool || toolFromRef(item.sourceRef) : label[item.sourceType]
  const isUrl = !!item.sourceRef && /^https?:\/\//.test(item.sourceRef)
  const plainRef = item.sourceRef && !isUrl && item.sourceType !== 'note' && item.sourceRef !== name ? item.sourceRef : null
  const parts: React.ReactNode[] = []
  if (item.sourceType === 'note' && item.sourceRef) {
    parts.push(
      <button key="n" className="hover:text-ink hover:underline" onClick={() => go('notes', item.sourceRef!)}>
        {name}
      </button>
    )
  } else if (isUrl) {
    parts.push(
      <button key="u" className="hover:text-ink hover:underline" onClick={() => call('shell.open', item.sourceRef)}>
        {name ? `${name} ↗` : 'Ver el original ↗'}
      </button>
    )
  } else if (name || plainRef) {
    parts.push(<span key="t">{[name, plainRef ? `«${plainRef}»` : null].filter(Boolean).join(' ')}</span>)
  }
  if (item.sourceSnippet) parts.push(<span key="s">{parts.length ? ' · ' : ''}«{item.sourceSnippet}»</span>)
  if (!parts.length) return null
  return <div className="mt-0.5 truncate text-[12px] text-faint">{parts}</div>
}

export function ItemRow({
  scored,
  item: plain,
  areas,
  index,
  why,
  compact
}: {
  scored?: ScoredItem
  item?: Item
  areas: Area[]
  index?: number
  why?: string
  compact?: boolean
}) {
  const { resolve, editItem } = useNav()
  const item = scored?.item ?? plain!
  const area = areas.find((a) => a.id === item.areaId)
  const reasons = why ?? scored?.reasons.join(' · ')
  const isDone = item.status === 'done'
  const done = () => call('items.update', item.id, { status: 'done' })

  if (isDone) {
    return (
      <div className="flex items-start gap-3 border-b border-line py-2.5 last:border-0">
        <CheckButton done onClick={() => call('items.update', item.id, { status: 'active' })} />
        <button className="min-w-0 flex-1 text-left text-muted line-through hover:underline" onClick={() => editItem(item)}>
          {item.title}
        </button>
      </div>
    )
  }

  return (
    <div className="group flex items-start gap-3 border-b border-line py-2.5 last:border-0">
      {index !== undefined ? (
        <span className="mt-0.5 w-4 text-[13px] font-semibold text-faint">{index}</span>
      ) : (
        <button
          onClick={done}
          aria-label="Marcar como hecho"
          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line-strong text-transparent hover:border-success hover:text-success"
        >
          <Icon name="check" className="h-3 w-3" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <button className="text-left font-medium hover:underline" onClick={() => editItem(item)}>
          {item.title}
        </button>
        {item.context ? <div className={`text-[12.5px] leading-snug text-muted ${compact ? 'line-clamp-2' : ''}`}>{item.context}</div> : null}
        {reasons ? <div className="text-[12.5px] text-muted">{reasons}</div> : null}
        {!compact ? <SourceLine item={item} /> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {item.person ? <Pill tone="clay">→ {item.person}</Pill> : null}
        {area && !compact ? <Pill tone="neutral">{area.name}</Pill> : null}
        <DuePill item={item} atRisk={scored?.atRisk} />
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {index !== undefined ? (
            <Button size="sm" variant="ghost" onClick={done} title="Marcar como hecho">
              <Icon name="check" />
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => resolve(item)} title="Resolver con Claude">
            <Icon name="sparkles" className="text-clay" /> Resolver
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Círculo para marcar como hecho; si ya está hecho, se ve marcado y al pulsarlo se desmarca. */
export function CheckButton({ done, onClick, small }: { done: boolean; onClick: () => void; small?: boolean }) {
  const size = small ? 'mt-[3px] h-3.5 w-3.5' : 'mt-0.5 h-4 w-4'
  return (
    <button
      onClick={onClick}
      aria-label={done ? 'Desmarcar' : 'Marcar como hecho'}
      title={done ? 'Desmarcar' : 'Marcar como hecho'}
      className={`flex ${size} shrink-0 items-center justify-center rounded-full border ${
        done ? 'border-success bg-success text-white' : 'border-line-strong text-transparent hover:border-success hover:text-success'
      }`}
    >
      <Icon name="check" className={small ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
    </button>
  )
}
