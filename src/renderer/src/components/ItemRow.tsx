import type { Area, Item, ScoredItem } from '@shared/types'
import { KIND_LABEL } from '@shared/types'
import { formatRelative } from '@shared/dates'
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
    note: 'Nota', capture: 'Captura', calendar: 'Calendario', file: 'Archivo', transcript: 'Acta', mcp: 'Herramienta', manual: 'Manual'
  }
  const isUrl = item.sourceRef && /^https?:\/\//.test(item.sourceRef)
  return (
    <div className="mt-0.5 truncate text-[12px] text-faint">
      {item.sourceType === 'note' && item.sourceRef ? (
        <button className="hover:text-ink hover:underline" onClick={() => go('notes', item.sourceRef!)}>
          {label[item.sourceType]}
        </button>
      ) : isUrl ? (
        <button className="hover:text-ink hover:underline" onClick={() => call('shell.open', item.sourceRef)}>
          {label[item.sourceType]}
        </button>
      ) : (
        <span>
          {label[item.sourceType]}
          {item.sourceRef && item.sourceType !== 'note' ? ` «${item.sourceRef}»` : ''}
        </span>
      )}
      {item.sourceSnippet ? <span> · «{item.sourceSnippet}»</span> : null}
    </div>
  )
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
  const done = () => call('items.update', item.id, { status: 'done' })

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
        {reasons ? <div className="text-[12.5px] text-muted">{reasons}</div> : null}
        {!compact ? <SourceLine item={item} /> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {item.kind !== 'task' ? <Pill>{KIND_LABEL[item.kind]}{item.person ? ` · ${item.person}` : ''}</Pill> : item.person ? <Pill>{item.person}</Pill> : null}
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
