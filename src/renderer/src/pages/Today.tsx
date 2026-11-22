import type { AiStatus, Brief, CalendarEvent, ScoredItem, TodayView } from '@shared/types'
import { formatDayLong, formatRelative } from '@shared/dates'
import { call, useAction, useData } from '../api'
import { ItemRow } from '../components/ItemRow'
import { Button, Card, Empty, ErrorNote, Icon, PageHeader, Pill, SectionLabel } from '../components/ui'
import { useNav } from '../nav'

const time = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })

export function Today({ ai }: { ai: AiStatus | null }) {
  const { go, editItem } = useNav()
  const { data, error } = useData<TodayView>('today.get', [], ['items', 'events', 'brief', 'areas', 'workflow'])
  const gen = useAction((useAI: boolean) => call<Brief>('brief.generate', useAI))

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!data) return null
  const { ranked, events, brief, areas } = data
  const byId = new Map(ranked.map((s) => [s.item.id, s]))
  const meetings = events.filter((e) => !e.allDay)

  const topIds = brief?.top.map((t) => t.itemId).filter((id) => byId.has(id)) ?? []
  const top: { s: ScoredItem; why: string }[] = (topIds.length ? topIds : ranked.slice(0, 3).map((s) => s.item.id))
    .slice(0, 3)
    .map((id) => ({ s: byId.get(id)!, why: brief?.top.find((t) => t.itemId === id)?.why ?? byId.get(id)!.reasons.join(' · ') }))
  const shown = new Set(top.map((t) => t.s.item.id))

  const promisesDue = ranked.filter((s) => s.item.kind === 'promise' && s.atRisk && !shown.has(s.item.id))
  const horizon = ranked
    .filter((s) => s.item.kind === 'deadline' && !shown.has(s.item.id) && s.daysToDue !== null && s.daysToDue <= 30)
    .slice(0, 6)
  const letGo = (brief?.letGo ?? []).map((l) => ({ l, s: byId.get(l.itemId) })).filter((x) => x.s)

  const subtitle = [
    `${meetings.length} ${meetings.length === 1 ? 'reunión' : 'reuniones'}`,
    `${ranked.filter((s) => s.atRisk).length} promesas en riesgo`,
    data.proposedCount ? `${data.proposedCount} por revisar en la bandeja` : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div>
      <PageHeader
        title={formatDayLong(data.date)}
        subtitle={subtitle}
        right={
          <>
            <Button variant="ghost" onClick={() => editItem(null)}>
              <Icon name="plus" /> Añadir
            </Button>
            <Button variant="claude" busy={gen.busy} onClick={() => gen.run(ai?.ok !== false)} title="Rehacer el brief con Claude">
              <Icon name="refresh" /> {brief ? 'Rehacer brief' : 'Preparar brief'}
            </Button>
          </>
        }
      />
      <ErrorNote>{gen.error}</ErrorNote>

      {brief ? (
        <p className="font-voice mb-1 text-[16px] leading-relaxed text-muted">{brief.summary}</p>
      ) : (
        <p className="text-[13px] text-faint">
          Todavía no hay brief de hoy. Abajo tienes la lista ordenada por la fórmula; pulsa «Preparar brief» para que Claude la ajuste con tu flujo y la agenda.
        </p>
      )}
      {brief && !brief.byAI ? <p className="text-[12px] text-faint">Brief sin IA, calculado solo con la fórmula.</p> : null}

      <SectionLabel>Las 3 cosas de hoy</SectionLabel>
      <Card className="px-4">
        {top.length ? (
          top.map(({ s, why }, i) => <ItemRow key={s.item.id} scored={s} areas={areas} index={i + 1} why={why} />)
        ) : (
          <div className="py-6 text-center text-[13px] text-muted">
            No hay nada pendiente.{' '}
            <button className="text-accent hover:underline" onClick={() => go('inbox')}>
              Captura algo
            </button>{' '}
            o escribe una nota.
          </div>
        )}
      </Card>

      {promisesDue.length ? (
        <>
          <SectionLabel>Promesas que vencen</SectionLabel>
          <Card className="px-4">
            {promisesDue.map((s) => (
              <ItemRow key={s.item.id} scored={s} areas={areas} />
            ))}
          </Card>
        </>
      ) : null}

      <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">
        <div>
          <SectionLabel right={<span className="text-[12px] text-faint">{meetings.length ? '' : 'Conecta tu calendario en Entradas'}</span>}>
            Agenda y qué preparar antes
          </SectionLabel>
          {meetings.length ? (
            <Card className="divide-y divide-line px-4">
              {meetings.map((e) => (
                <Meeting key={e.id} e={e} checklist={brief?.prepare.find((p) => p.eventId === e.id)?.checklist ?? []} />
              ))}
            </Card>
          ) : (
            <Empty title="Sin reuniones hoy" />
          )}
        </div>
        <div>
          <SectionLabel>Entregas en el horizonte</SectionLabel>
          {horizon.length ? (
            <Card className="px-4">
              {horizon.map((s) => (
                <ItemRow key={s.item.id} scored={s} areas={areas} compact />
              ))}
            </Card>
          ) : (
            <Empty title="Nada en los próximos 30 días" />
          )}

          {letGo.length ? (
            <>
              <SectionLabel>Puedes soltar</SectionLabel>
              <Card className="px-4 py-1">
                {letGo.map(({ l, s }) => (
                  <div key={l.itemId} className="flex items-center gap-2 border-b border-line py-2 text-[13px] last:border-0">
                    <span className="flex-1 text-muted">
                      {s!.item.title} <span className="text-faint">→ {l.suggestion}</span>
                    </span>
                    {s!.item.dueDate ? <span className="text-[12px] text-faint">{formatRelative(data.date, s!.item.dueDate)}</span> : null}
                  </div>
                ))}
              </Card>
            </>
          ) : null}
        </div>
      </div>

      {brief?.rulesApplied.length ? (
        <>
          <SectionLabel>Reglas de tu flujo que se aplicaron hoy</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {brief.rulesApplied.map((r) => (
              <Pill key={r} tone="neutral">
                <Icon name="route" className="h-3 w-3" /> {r}
              </Pill>
            ))}
          </div>
        </>
      ) : null}

      {ranked.length > 3 ? (
        <>
          <SectionLabel>Todo lo activo, por prioridad</SectionLabel>
          <Card className="px-4">
            {ranked
              .filter((s) => !shown.has(s.item.id))
              .map((s) => (
                <ItemRow key={s.item.id} scored={s} areas={areas} />
              ))}
          </Card>
        </>
      ) : null}
      <div className="h-10" />
    </div>
  )
}

function Meeting({ e, checklist }: { e: CalendarEvent; checklist: string[] }) {
  return (
    <div className="py-3">
      <div className="flex items-baseline gap-3">
        <span className="w-12 shrink-0 text-[13px] font-medium tabular-nums">{time(e.start)}</span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{e.title}</div>
          <div className="text-[12px] text-faint">
            {[
              e.location,
              e.attendees.length === 1
                ? `Con ${e.attendees[0]}`
                : e.attendees.length
                  ? `${e.attendees.length} personas: ${e.attendees.slice(0, 4).join(', ')}${e.attendees.length > 4 ? '…' : ''}`
                  : null
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </div>
      {checklist.length ? (
        <ul className="mt-1.5 ml-15 space-y-0.5 text-[13px] text-muted">
          {checklist.map((c) => (
            <li key={c} className="flex gap-2">
              <span className="text-faint">○</span> {c}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
