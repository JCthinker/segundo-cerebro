import { useState } from 'react'
import type { AiStatus, Brief, CalendarEvent, FlowItem, Item, MeetingInfo, ScoredItem, TodayView } from '@shared/types'
import { formatDayLong, parseDay } from '@shared/dates'
import { isDone, planDays, todayIds, type DayPlan, type PlanEntry } from '@shared/plan'
import { call, useAction, useData } from '../api'
import { DismissButton } from '../components/Dismiss'
import { NewsBox } from '../components/NewsBox'
import { CheckButton, ItemRow, SourceLine } from '../components/ItemRow'
import { Button, Card, ErrorNote, Icon, inputCls, Pill, SectionLabel, textareaCls } from '../components/ui'
import { useNav } from '../nav'

const time = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
const weekday = (day: string) => parseDay(day).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' })
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function Dashboard({ ai, shortcut }: { ai: AiStatus | null; shortcut: string | null }) {
  const { editItem, go } = useNav()
  const { data, error } = useData<TodayView>('today.get', [], ['items', 'events', 'brief', 'areas', 'workflow'])
  const gen = useAction((useAI: boolean) => call<Brief>('brief.generate', useAI))

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!data) return null
  const { ranked, brief, areas, date } = data
  const plan = planDays([...ranked, ...data.doneToday], data.events, date)
  const [today, ...next] = plan.days
  const byId = new Map(ranked.map((s) => [s.item.id, s]))
  const checklists: Checklists = new Map((brief?.prepare ?? []).map((p) => [p.eventId, { items: p.checklist, done: new Set(p.done ?? []) }]))

  // «Empieza por»: lo que eligió Claude en el brief o, sin brief, lo más urgente de hoy.
  // Si le has cambiado la fecha a algo que eligió Claude, ya no toca hoy y va a su nuevo día.
  const urgent = [...plan.overdue, ...today.entries.filter((e) => !isDone(e.s))].sort((a, b) => b.s.score - a.s.score)
  const forToday = todayIds(plan)
  const briefTop = (brief?.top ?? []).filter((t) => byId.has(t.itemId) && forToday.has(t.itemId))
  const top: { s: ScoredItem; why: string }[] = briefTop.length
    ? briefTop.slice(0, 3).map((t) => ({ s: byId.get(t.itemId)!, why: t.why }))
    : urgent.slice(0, 3).map((e) => ({ s: e.s, why: e.s.reasons.join(' · ') }))
  const shown = new Set(top.map((t) => t.s.item.id))
  const notShown = (e: PlanEntry) => !shown.has(e.s.item.id)

  const overdue = plan.overdue.filter(notShown)
  const todayRest = today.entries.filter(notShown)
  const meetingsToday = today.events.filter((e) => !e.allDay)
  const undated = plan.undated.filter((s) => !shown.has(s.item.id))
  const later = plan.later.filter(notShown).slice(0, 8)

  const subtitle = [
    plural(meetingsToday.length, 'reunión', 'reuniones'),
    plural(top.length + todayRest.filter((e) => !isDone(e.s)).length, 'cosa para hoy', 'cosas para hoy'),
    plan.overdue.length ? plural(plan.overdue.length, 'atrasada', 'atrasadas') : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div>
      <div className="mb-5 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-semibold tracking-tight first-letter:uppercase">{formatDayLong(date)}</h1>
          <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>
        </div>
        <Button variant="ghost" onClick={() => editItem(null)}>
          <Icon name="plus" /> Añadir
        </Button>
        <Button variant="claude" busy={gen.busy} onClick={() => gen.run(ai?.ok !== false)} title="Claude repasa tu contexto y reordena el día">
          <Icon name="refresh" /> {brief ? 'Repasar el día' : 'Preparar el día'}
        </Button>
      </div>
      <ErrorNote>{gen.error}</ErrorNote>

      {brief?.weekly ? <Weekly text={brief.weekly} answered={data.weeklyAnswered} /> : null}
      {brief ? <p className="font-voice mb-4 text-[16px] leading-relaxed text-muted">{brief.summary}</p> : null}

      <QuickBox ai={ai} shortcut={shortcut} />

      <NewsBox items={ranked} />

      <FlowSection items={data.flow} />
      {data.lessonsNew >= 5 ? (
        <button className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink" onClick={() => go('notes', 'mi-flujo')}>
          <Icon name="sparkles" className="h-3.5 w-3.5 text-clay" /> Claude ha aprendido {data.lessonsNew} cosas de tus correcciones · Convertirlas en reglas de Mi flujo →
        </button>
      ) : null}

      {overdue.length ? (
        <>
          <SectionLabel>Atrasado</SectionLabel>
          <Card className="border-danger/30 px-4">
            {overdue.map((e) => (
              <ItemRow key={e.s.item.id} scored={e.s} areas={areas} why={e.note ?? undefined} compact />
            ))}
          </Card>
        </>
      ) : null}

      <SectionLabel
        right={
          data.encargos ? (
            <button className="text-[12.5px] text-muted hover:text-ink hover:underline" onClick={() => go('encargos')}>
              {plural(data.encargos, 'encargo', 'encargos')} en total →
            </button>
          ) : null
        }
      >
        Hoy · tareas y encargos
      </SectionLabel>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="px-4 lg:col-span-3">
          {top.length || todayRest.length || undated.length ? (
            <>
              {top.map(({ s, why }, i) => (
                <ItemRow key={s.item.id} scored={s} areas={areas} index={i + 1} why={why} />
              ))}
              {todayRest.map((e) => (
                <ItemRow key={e.s.item.id} scored={e.s} areas={areas} why={e.note ?? undefined} compact />
              ))}
              {undated.length ? (
                <>
                  <div className="border-b border-line pt-3 pb-1 text-[11.5px] font-medium tracking-wide text-faint uppercase">Sin fecha</div>
                  {undated.map((s) => (
                    <ItemRow key={s.item.id} scored={s} areas={areas} compact />
                  ))}
                </>
              ) : null}
            </>
          ) : (
            <div className="py-6 text-center text-[13px] text-muted">Nada pendiente para hoy.</div>
          )}
        </Card>
        <Card className="divide-y divide-line px-4 lg:col-span-2">
          {today.events.length ? (
            today.events.map((e) => <Meeting key={e.id} e={e} checklist={checklists.get(e.id)} info={data.meetings?.[e.id]} />)
          ) : (
            <div className="py-6 text-center text-[13px] text-faint">Sin reuniones hoy</div>
          )}
        </Card>
      </div>

      <SectionLabel>Próximos días</SectionLabel>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {next.map((d, i) => (
          <DayCard key={d.day} d={d} label={i === 0 ? 'Mañana' : weekday(d.day)} checklists={checklists} skip={shown} meetings={data.meetings ?? {}} />
        ))}
      </div>

      <Detected items={data.proposed} />

      {later.length ? (
        <>
          <SectionLabel>Más adelante</SectionLabel>
          <Card className="px-3 py-1">
            {later.map((e) => (
              <MiniRow key={e.s.item.id} s={e.s} note={e.note} />
            ))}
          </Card>
        </>
      ) : null}
      <div className="h-10" />
    </div>
  )
}

/**
 * Una sola caja para hablar con Claude: lo que escribes va a la conversación de la derecha,
 * donde te contesta qué ha apuntado, qué ha hecho o qué necesita saber.
 */
function QuickBox({ ai, shortcut }: { ai: AiStatus | null; shortcut: string | null }) {
  const { talk } = useNav()
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [transcript, setTranscript] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const noAi = ai?.ok === false

  const send = () => {
    const said = text.trim()
    if (!said) return
    talk(said)
    setText('')
    setMsg(null)
  }
  const note = useAction(async () => {
    if (!text.trim()) throw new Error('Pega el acta primero.')
    const n = await call<number>('transcript', text, title)
    setMsg(n ? `${plural(n, 'cosa apuntada', 'cosas apuntadas')} en tu lista.` : 'No he encontrado nada que hacer en esa acta.')
    setText('')
    setTitle('')
  })
  const fromFile = useAction(async () => {
    const n = await call<number | null>('file.import')
    if (n !== null) setMsg(n ? `${plural(n, 'cosa apuntada', 'cosas apuntadas')} del archivo en tu lista.` : 'No he encontrado nada que hacer en el archivo.')
  })

  return (
    <Card className="p-3">
      {transcript ? <input className={`${inputCls} mb-2`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título de la reunión" /> : null}
      <textarea
        rows={transcript ? 6 : 2}
        className={`${textareaCls} border-0 bg-transparent`}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setMsg(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !transcript) {
            e.preventDefault()
            send()
          }
        }}
        placeholder={
          noAi
            ? 'Conecta Claude en Ajustes para hablar con él'
            : transcript
              ? 'Pega aquí el acta o la transcripción'
              : 'Dile algo a Claude: «le dije a Ana que el jueves le mando el informe», «¿qué tengo que preparar para mañana?», «avisa a Luis por Slack»…'
        }
      />
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button className={`rounded-md px-2 py-1 text-[12px] ${transcript ? 'bg-selected text-ink' : 'text-muted hover:bg-hover'}`} onClick={() => setTranscript(!transcript)}>
          <Icon name="users" className="mr-1 inline h-3.5 w-3.5" />
          Acta de reunión
        </button>
        <button className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover" onClick={() => fromFile.run()}>
          <Icon name="file" className="mr-1 inline h-3.5 w-3.5" />
          {fromFile.busy ? 'Analizando…' : 'Analizar un archivo'}
        </button>
        <span className="text-[11.5px] text-faint">{transcript ? '' : 'Intro para enviar'}{shortcut ? `${transcript ? '' : ' · '}Desde cualquier app: ${shortcut}` : ''}</span>
        <div className="ml-auto flex gap-1.5">
          {transcript ? (
            <Button variant="claude" busy={note.busy} disabled={noAi || !text.trim()} onClick={() => note.run()}>
              <Icon name="sparkles" /> Sacar tareas del acta
            </Button>
          ) : (
            <Button variant="claude" disabled={noAi || !text.trim()} onClick={send}>
              <Icon name="arrow" /> Enviar a Claude
            </Button>
          )}
        </div>
      </div>
      <ErrorNote>{note.error || fromFile.error}</ErrorNote>
      {msg ? <p className="mt-2 px-1 text-[13px] text-success">{msg}</p> : null}
    </Card>
  )
}

type Checklists = Map<string, { items: string[]; done: Set<string> }>

/** Un punto de la checklist de una reunión: se marca y desmarca; tachado hasta que acaba el día. */
function CheckItem({ eventId, text, done }: { eventId: string; text: string; done: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <CheckButton small done={done} onClick={() => call('brief.check', eventId, text, !done)} />
      <span className={done ? 'text-faint line-through' : ''}>{text}</span>
    </li>
  )
}

function DayCard({ d, label, checklists, skip, meetings }: { d: DayPlan; label: string; checklists: Checklists; skip: Set<string>; meetings: Record<string, MeetingInfo> }) {
  const { go } = useNav()
  const entries = d.entries.filter((e) => !skip.has(e.s.item.id))
  const pending = entries.filter((e) => !isDone(e.s)).length
  const empty = !d.events.length && !entries.length
  return (
    <Card className={`px-3 py-2.5 ${empty ? 'opacity-60' : ''}`}>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[13px] font-semibold first-letter:uppercase">{label}</span>
        <span className="ml-auto text-[11.5px] text-faint">
          {[d.events.filter((e) => !e.allDay).length ? plural(d.events.filter((e) => !e.allDay).length, 'reunión', 'reuniones') : null, pending ? plural(pending, 'cosa', 'cosas') : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      {empty ? <div className="py-2 text-[12.5px] text-faint">Libre</div> : null}
      {d.events.map((e) => {
        const list = checklists.get(e.id)
        return (
          <div key={e.id} className="py-1 text-[12.5px]">
            <div className="flex gap-2">
              <span className="w-10 shrink-0 tabular-nums text-faint">{e.allDay ? 'Día' : time(e.start)}</span>
              <button
                className="min-w-0 flex-1 truncate text-left hover:underline"
                title={meetings[e.id]?.noteId ? 'Ver notas' : 'Tomar notas'}
                onClick={async () => !e.allDay && go('notes', await call<string>('meeting.note', e.id))}
              >
                {e.title}
              </button>
              {meetings[e.id] && meetings[e.id].type !== 'other' ? <span className="shrink-0 text-[11px] text-clay">{meetings[e.id].label}</span> : null}
            </div>
            {meetings[e.id]?.jira.length ? (
              <ul className="ml-12 list-disc pl-3 text-[11.5px] text-faint">
                {meetings[e.id].jira.slice(0, 3).map((j) => (
                  <li key={j}>{j}</li>
                ))}
              </ul>
            ) : null}
            {list?.items.length ? (
              <ul className="ml-12 space-y-0.5 text-muted">
                {list.items.map((c) => (
                  <CheckItem key={c} eventId={e.id} text={c} done={list.done.has(c)} />
                ))}
              </ul>
            ) : null}
          </div>
        )
      })}
      {d.events.length && entries.length ? <div className="my-1 border-t border-line" /> : null}
      {entries.map((e) => (
        <MiniRow key={e.s.item.id} s={e.s} note={e.note} />
      ))}
    </Card>
  )
}

function MiniRow({ s, note }: { s: ScoredItem; note: string | null }) {
  const { editItem } = useNav()
  const item = s.item
  const done = isDone(s)
  return (
    <div className="flex items-start gap-2 py-1 text-[13px]">
      <CheckButton small done={done} onClick={() => call('items.update', item.id, { status: done ? 'active' : 'done' })} />
      <div className="min-w-0 flex-1">
        <button className={`text-left hover:underline ${done ? 'text-faint line-through' : ''}`} onClick={() => editItem(item)} title={item.context ?? undefined}>
          {item.title}
          {item.person ? <span className="text-clay"> → {item.person}</span> : null}
        </button>
        {note && !done ? <div className="text-[11.5px] text-faint">{note}</div> : null}
      </div>
    </div>
  )
}

function Detected({ items }: { items: Item[] }) {
  const { editItem } = useNav()
  if (!items.length) return null
  const confirm = (i: Item) => call('items.update', i.id, { status: 'active' })
  return (
    <>
      <SectionLabel
        right={
          items.length > 1 ? (
            <Button size="sm" variant="ghost" onClick={async () => { for (const i of items) await confirm(i) }}>
              Confirmar todo
            </Button>
          ) : null
        }
      >
        Nuevo detectado ({items.length})
      </SectionLabel>
      <Card className="px-4">
        <p className="border-b border-line py-2 text-[12px] text-faint">Claude lo encontró en tus notas, calendario y herramientas. No cuenta hasta que lo confirmas.</p>
        {items.map((i) => (
          <div key={i.id} className="flex items-start gap-3 border-b border-line py-2.5 last:border-0">
            <div className="min-w-0 flex-1">
              <button className="text-left font-medium hover:underline" onClick={() => editItem(i)}>
                {i.title}
                {i.person ? <span className="font-normal text-clay"> → {i.person}</span> : null}
              </button>
              {i.context ? <p className="mt-0.5 text-[13px] leading-snug text-muted">{i.context}</p> : null}
              <div className="mt-1 flex flex-wrap gap-1.5">
                {i.dueDate ? <Pill>Vence {parseDay(i.dueDate).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}</Pill> : null}
                {i.prepDays ? <Pill>{plural(i.prepDays, 'día', 'días')} de preparación</Pill> : null}
              </div>
              <SourceLine item={i} />
            </div>
            <div className="flex shrink-0 gap-1">
              <DismissButton item={i} />
              <Button size="sm" variant="primary" onClick={() => confirm(i)}>
                <Icon name="check" /> Confirmar
              </Button>
            </div>
          </div>
        ))}
      </Card>
    </>
  )
}

function Meeting({ e, checklist, info }: { e: CalendarEvent; checklist?: { items: string[]; done: Set<string> }; info?: MeetingInfo }) {
  const { go, talk } = useNav()
  const openNote = useAction(async () => go('notes', await call<string>('meeting.note', e.id)))
  const typed = info && info.type !== 'other'
  return (
    <div className="py-2.5">
      <div className="flex items-baseline gap-3">
        <span className="w-11 shrink-0 text-[13px] font-medium tabular-nums">{e.allDay ? 'Día' : time(e.start)}</span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {e.title}
            {typed ? <span className="ml-2 text-[11.5px] font-normal text-clay">{info.label}</span> : null}
          </div>
          {e.attendees.length || e.location ? (
            <div className="truncate text-[12px] text-faint">
              {[e.location, e.attendees.length === 1 ? `Con ${e.attendees[0]}` : e.attendees.length ? `${e.attendees.length} personas` : null].filter(Boolean).join(' · ')}
            </div>
          ) : null}
        </div>
      </div>
      {info?.jira.length ? (
        <div className="mt-1.5 ml-14">
          <div className="text-[11px] font-medium tracking-wide text-faint uppercase">Llevar, según Jira</div>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[12.5px] text-muted">
            {info.jira.map((j) => (
              <li key={j}>{j}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {checklist?.items.length ? (
        <ul className="mt-1 ml-14 space-y-0.5 text-[12.5px] text-muted">
          {checklist.items.map((c) => (
            <CheckItem key={c} eventId={e.id} text={c} done={checklist.done.has(c)} />
          ))}
        </ul>
      ) : null}
      {e.allDay ? null : (
        <div className="mt-1.5 ml-14 flex gap-1.5">
          <Button size="sm" variant="ghost" busy={openNote.busy} onClick={() => openNote.run()}>
            <Icon name="notes" /> {info?.noteId ? 'Ver notas' : 'Tomar notas'}
          </Button>
          {typed ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                talk(
                  `Ayúdame a preparar la reunión «${e.title}» (${info.label}, ${new Date(e.start).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}). Busca en mis notas de la app y en las transcripciones de Google Drive lo que tenga que ver, mira las iniciativas en Jira y dime qué llevar.`
                )
              }
            >
              <Icon name="sparkles" className="text-clay" /> Preparar con Claude
            </Button>
          ) : null}
        </div>
      )}
      <ErrorNote>{openNote.error}</ErrorNote>
    </div>
  )
}

/** «Lo que toca esta semana»: la lectura de Claude, que puedes aceptar o corregir. */
function Weekly({ text, answered }: { text: string; answered: boolean }) {
  const [why, setWhy] = useState<string | null>(null)
  const react = useAction((agree: boolean, reason?: string) => call('brief.react', agree, reason))
  return (
    <Card className="mb-4 border-clay/30 bg-clay/5 px-5 py-4">
      <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium tracking-wide text-clay uppercase">
        <Icon name="sparkles" className="h-3.5 w-3.5" /> Lo que toca esta semana
      </div>
      <p className="font-voice text-[16px] leading-relaxed">{text}</p>
      {answered ? null : why === null ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="ghost" busy={react.busy} onClick={() => react.run(true)}>
            <Icon name="check" /> De acuerdo
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWhy('')}>
            No lo veo así
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <input
            autoFocus
            className={inputCls}
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && why.trim() && react.run(false, why)}
            placeholder="¿Qué es lo importante esta semana? Claude lo tendrá en cuenta"
          />
          <Button size="sm" variant="primary" busy={react.busy} disabled={!why.trim()} onClick={() => react.run(false, why)}>
            Enviar
          </Button>
        </div>
      )}
      <ErrorNote>{react.error}</ErrorNote>
    </Card>
  )
}

/** Flujo de producto · para hoy: lo que hay que mover en Jira, con su porqué. */
function FlowSection({ items }: { items: FlowItem[] }) {
  const { talk } = useNav()
  const [all, setAll] = useState(false)
  if (!items.length) return null
  const shown = all ? items : items.slice(0, 5)
  const hide = (f: FlowItem, how: 'later' | 'notNeeded' | 'done') => call('flow.hide', f.key, how, f.title)
  return (
    <>
      <SectionLabel>Flujo de producto · para hoy</SectionLabel>
      <Card className="px-4">
        {shown.map((f, i) => (
          <div key={f.key} className="group flex items-start gap-3 border-b border-line py-3 last:border-0">
            <span className="mt-0.5 w-5 shrink-0 text-[13px] font-semibold text-clay tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {f.title}
                {f.ref ? (
                  <button className="ml-2 text-[12px] font-normal text-faint hover:text-ink hover:underline" onClick={() => f.url && call('shell.open', f.url)}>
                    {f.ref}
                  </button>
                ) : null}
              </div>
              <p className="mt-0.5 text-[13px] leading-snug text-muted">{f.why}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="claude" onClick={() => talk(`Ayúdame con esto del flujo de producto: «${f.title}»${f.ref ? ` (${f.ref})` : ''}. ${f.why}`)}>
                  <Icon name="sparkles" /> Hacer con Claude
                </Button>
                <Button size="sm" variant="ghost" onClick={() => hide(f, 'done')}>
                  <Icon name="check" /> Hecho
                </Button>
                <Button size="sm" variant="ghost" onClick={() => hide(f, 'later')}>
                  Ahora no
                </Button>
                <Button size="sm" variant="ghost" onClick={() => hide(f, 'notNeeded')} title="Claude lo apunta para no volver a proponerlo así">
                  No hace falta
                </Button>
              </div>
            </div>
          </div>
        ))}
        {items.length > 5 ? (
          <button className="w-full py-2.5 text-[12.5px] text-muted hover:text-ink" onClick={() => setAll(!all)}>
            {all ? 'Ver menos' : `Ver ${items.length - 5} más`}
          </button>
        ) : null}
      </Card>
    </>
  )
}
