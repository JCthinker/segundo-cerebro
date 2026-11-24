import { useState } from 'react'
import { addDays } from '@shared/dates'
import type { Area, ScoredItem } from '@shared/types'
import { useData } from '../api'
import { ItemRow } from '../components/ItemRow'
import { Button, Card, Empty, ErrorNote, Icon, PageHeader, SectionLabel } from '../components/ui'
import { useNav } from '../nav'

interface EncargosView {
  date: string
  areas: Area[]
  active: ScoredItem[]
  done: ScoredItem[]
}

/** Lo que te piden otras personas: va a tu lista, no a Jira. */
export function Encargos() {
  const { data, error } = useData<EncargosView>('encargos.get', [], ['items'])
  const { editItem } = useNav()
  const [tab, setTab] = useState<'open' | 'done'>('open')
  const [person, setPerson] = useState<string | null>(null)

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!data) return null
  const { date, areas } = data
  const weekEnd = addDays(date, 6)
  const people = [...new Set(data.active.map((s) => s.item.person).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'es'))
  const list = (tab === 'open' ? data.active : data.done).filter((s) => !person || s.item.person === person)
  const groups: [string, ScoredItem[]][] =
    tab === 'open'
      ? [
          ['Para hoy o atrasado', list.filter((s) => s.item.dueDate && s.item.dueDate <= date)],
          ['Esta semana', list.filter((s) => s.item.dueDate && s.item.dueDate > date && s.item.dueDate <= weekEnd)],
          ['Más adelante', list.filter((s) => s.item.dueDate && s.item.dueDate > weekEnd)],
          ['Sin fecha', list.filter((s) => !s.item.dueDate)]
        ]
      : [['Hechos', list]]

  return (
    <div>
      <PageHeader
        title="Encargos"
        subtitle="Lo que te piden otras personas. Claude los saca de tus notas, reuniones y mensajes; no van a Jira."
        right={
          <Button variant="ghost" onClick={() => editItem(null, { kind: 'promise' })}>
            <Icon name="plus" /> Añadir encargo
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 border-b border-line">
          {(
            [
              ['open', `Pendientes · ${data.active.length}`],
              ['done', 'Hechos']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${tab === id ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {people.length > 1 ? (
          <div className="ml-auto flex flex-wrap gap-1">
            {[null, ...people].map((p) => (
              <button
                key={p ?? 'all'}
                onClick={() => setPerson(p)}
                className={`h-7 rounded-lg border px-2.5 text-[12.5px] ${person === p ? 'border-ink bg-ink text-page' : 'border-line-strong text-muted hover:text-ink'}`}
              >
                {p ?? 'Todos'}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!list.length ? (
        <Empty title={tab === 'open' ? 'No tienes encargos pendientes' : 'Aún no has terminado ninguno'}>
          {tab === 'open' ? 'Cuando alguien te pida algo en una reunión, una nota o un mensaje, Claude lo apuntará aquí.' : 'Los encargos que marques como hechos aparecerán aquí.'}
        </Empty>
      ) : (
        groups
          .filter(([, g]) => g.length)
          .map(([label, g]) => (
            <div key={label}>
              <SectionLabel>
                {label} ({g.length})
              </SectionLabel>
              <Card className="px-4">
                {g.map((s) => (
                  <ItemRow key={s.item.id} scored={s} areas={areas} compact />
                ))}
              </Card>
            </div>
          ))
      )}
      <div className="h-10" />
    </div>
  )
}
