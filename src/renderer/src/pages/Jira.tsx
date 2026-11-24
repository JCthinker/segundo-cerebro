import { useEffect, useMemo, useState } from 'react'
import { setScreenDetail } from '../screen'
import { buildBoard, matches, readAgo, taskReady, type BoardCard, type JiraPrefs, type JiraSnapshot, type JiraTask, type Warning } from '@shared/jira'
import { JiraCustomize } from '../components/JiraCustomize'
import { call, useAction, useData } from '../api'
import { Button, Card, Empty, ErrorNote, Icon, inputBase, PageHeader, Pill, Spinner } from '../components/ui'
import { useNav } from '../nav'
import { SprintTab } from '../components/SprintTab'
import { MeasureTab } from '../components/MeasureTab'

interface JiraView {
  snapshot: JiraSnapshot | null
  connector: string | null
  syncing: boolean
  error: string | null
  projects: { road: string; fp: string }
  prefs: JiraPrefs
}

type Tab = 'road' | 'sprint' | 'measure' | 'fp' | 'epics'

const open = (url: string | null) => {
  if (url) void call('shell.open', url)
}

function Warn({ w }: { w: Warning }) {
  return <Pill tone={w.tone}>{w.text}</Pill>
}

export function Jira() {
  const { data, error } = useData<JiraView>('jira.get', [], ['jira'])
  const { go, openInitiative } = useNav()
  const sync = useAction(() => call('jira.sync'))
  const [tab, setTab] = useState<Tab>('road')
  const [q, setQ] = useState('')
  const [onlyWarn, setOnlyWarn] = useState(false)
  const [lowBacklog, setLowBacklog] = useState(false)
  const [customizing, setCustomizing] = useState(false)

  useEffect(() => {
    setScreenDetail(`pestaña ${({ road: 'Iniciativas ROAD (tablero por pasos)', sprint: 'Sprint y épicas', measure: 'Mediciones', fp: 'Tareas FP', epics: 'Épicas' } as Record<Tab, string>)[tab]}`)
  }, [tab])
  const snap = data?.snapshot ?? null
  const board = useMemo(() => (snap ? buildBoard(snap, new Date()) : []), [snap])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!data) return null
  const busy = data.syncing || sync.busy

  const header = (
    <PageHeader
      title="Todo Jira"
      subtitle={
        snap
          ? `Cada iniciativa de ${data.projects.road} en el paso en que está, con lo que le falta. Leído ${readAgo(snap.at, new Date())}.`
          : `Cada iniciativa de ${data.projects.road} en el paso en que está, con lo que le falta.`
      }
      right={
        <div className="flex gap-1.5">
          <Button variant="ghost" onClick={() => setCustomizing(true)}>
            <Icon name="settings" /> Personalizar
          </Button>
          {data.connector ? (
            <Button onClick={() => void sync.run()} busy={busy}>
              {!busy ? <Icon name="refresh" /> : null}
              {busy ? 'Leyendo Jira…' : 'Actualizar'}
            </Button>
          ) : null}
        </div>
      }
    />
  )
  const customize = customizing ? <JiraCustomize prefs={data.prefs} snap={snap} onClose={() => setCustomizing(false)} /> : null

  if (!data.connector && !snap)
    return (
      <div>
        {header}
        {customize}
        <Empty
          title="Falta la conexión de Jira"
          action={
            <Button variant="primary" onClick={() => go('sources')}>
              Ir a Entradas
            </Button>
          }
        >
          La app lee Jira a través de tu cuenta de Claude, y ahora mismo no tiene Jira conectado. Entra en claude.ai → Ajustes → Conectores, añade Atlassian (Jira) e inicia sesión. Después vuelve aquí: la app lo detecta sola.
        </Empty>
      </div>
    )

  if (!snap)
    return (
      <div>
        {header}
        {customize}
        <ErrorNote>{sync.error ?? (busy ? null : data.error)}</ErrorNote>
        {busy ? (
          <Card className="flex items-center gap-3 px-5 py-6 text-[13.5px] text-muted">
            <Spinner /> Claude está leyendo {data.projects.road} y {data.projects.fp}. La primera vez puede tardar un par de minutos.
          </Card>
        ) : (
          <Empty title="Aún no se ha leído Jira" action={<Button variant="primary" onClick={() => void sync.run()}>Leer Jira ahora</Button>}>
            Claude leerá tus iniciativas y tareas. Después se actualiza sola cada 3 horas mientras la app está abierta.
          </Empty>
        )}
      </div>
    )

  const cardShown = (c: BoardCard) => matches(`${c.key} ${c.title}`, q) && (!onlyWarn || c.warnings.length > 0)
  const columns = board
    .filter((col) => !data.prefs.hidden.includes(col.id))
    .filter((col) => lowBacklog || (col.id !== 'backlog3' && col.id !== 'backlog2'))
    .map((col) => ({ ...col, cards: col.cards.filter(cardShown) }))
  const hiddenLow = board.filter((c) => c.id === 'backlog3' || c.id === 'backlog2').reduce((n, c) => n + c.cards.length, 0)
  const tasks = snap.tasks.filter((t) => t.epicKey !== t.key)

  return (
    <div>
      {header}
        {customize}
      <ErrorNote>{sync.error ?? data.error}</ErrorNote>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint">
            <Icon name="search" />
          </span>
          <input aria-label="Buscar en Jira" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" className={`${inputBase} w-56 pl-8`} />
        </label>
        <button
          onClick={() => setOnlyWarn(!onlyWarn)}
          className={`h-8 rounded-lg border px-3 text-[13px] ${onlyWarn ? 'border-ink bg-ink text-page' : 'border-line-strong text-muted hover:text-ink'}`}
        >
          Solo con avisos
        </button>
        {tab === 'road' && hiddenLow ? (
          <button onClick={() => setLowBacklog(!lowBacklog)} className="text-[12.5px] text-muted underline hover:text-ink">
            {lowBacklog ? 'Ocultar Backlog 2 y 3' : `Ver Backlog 2 y 3 (${hiddenLow})`}
          </button>
        ) : null}
      </div>

      <div className="mb-4 flex gap-1 border-b border-line">
        {(
          [
            ['road', `Iniciativas ${data.projects.road} · ${snap.initiatives.length}`],
            ['sprint', 'Sprint y épicas'],
            ['measure', 'Mediciones'],
            ['fp', `Tareas ${data.projects.fp} · ${tasks.length}`],
            ['epics', `Épicas · ${snap.epics.length}`]
          ] as [Tab, string][]
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

      {tab === 'road' ? (
        <div className="-mx-8 overflow-x-auto px-8 pb-4">
          <div className="flex gap-3">
            {columns.map((col) => (
              <div key={col.id} className="flex w-56 shrink-0 flex-col gap-2">
                <div className="flex items-center justify-between px-1 text-[12.5px] font-medium">
                  <span>{col.label}</span>
                  <span className="text-faint">{col.cards.length}</span>
                </div>
                {col.cards.map((c) => (
                  <button key={c.key} onClick={() => openInitiative(c.key)} className="rounded-xl border border-line bg-raised p-3 text-left hover:border-line-strong">
                    <div className="flex items-center justify-between gap-2 text-[11.5px] text-faint">
                      <span>{c.key}</span>
                      {c.quarter ? <span className={c.quarterRank === 0 ? 'font-medium text-ink' : ''}>{c.quarter}</span> : null}
                    </div>
                    <div className="mt-1 text-[13px] leading-snug font-medium">{c.title}</div>
                    {c.taskKeys.length || c.developers.length ? (
                      <div className="mt-1.5 text-[11.5px] text-muted">
                        {[c.developers.join(', '), c.taskKeys.length ? `${c.tasksDone} de ${c.taskKeys.length} FP hechas` : ''].filter(Boolean).join(' · ')}
                      </div>
                    ) : null}
                    {c.warnings.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.warnings.map((w) => (
                          <Warn key={w.text} w={w} />
                        ))}
                      </div>
                    ) : null}
                  </button>
                ))}
                {!col.cards.length ? <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[12px] text-faint">Nada</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'sprint' ? <SprintTab snap={snap} /> : null}
      {tab === 'measure' ? <MeasureTab /> : null}

      {tab === 'fp' ? <TaskTable tasks={tasks.filter((t) => matches(`${t.key} ${t.title}`, q) && (!onlyWarn || !taskReady(t)))} /> : null}

      {tab === 'epics' ? (
        <Card>
          {snap.epics.filter((e) => matches(`${e.key} ${e.title}`, q)).length ? (
            snap.epics
              .filter((e) => matches(`${e.key} ${e.title}`, q))
              .map((e) => (
                <button key={e.key} onClick={() => open(e.url)} className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-hover">
                  <span className="w-20 shrink-0 text-[12px] text-faint">{e.key}</span>
                  <span className="min-w-0 flex-1 text-[13.5px] font-medium">{e.title}</span>
                  <span className="text-[12px] text-muted">
                    {e.roadKey ?? 'Sin iniciativa'} · {e.taskKeys.length} FP
                  </span>
                </button>
              ))
          ) : (
            <p className="px-4 py-6 text-center text-[13px] text-muted">No hay épicas.</p>
          )}
        </Card>
      ) : null}
    </div>
  )
}

function TaskTable({ tasks }: { tasks: JiraTask[] }) {
  if (!tasks.length) return <p className="py-6 text-center text-[13px] text-muted">No hay tareas que mostrar.</p>
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-[12px] text-muted">
            <th className="px-4 py-2 font-medium">Tarea</th>
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium">Sprint</th>
            <th className="px-4 py-2 font-medium">Lista</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.key} onClick={() => open(t.url)} className="cursor-pointer border-b border-line last:border-0 hover:bg-hover">
              <td className="px-4 py-2.5">
                <span className="mr-2 text-[12px] text-faint">{t.key}</span>
                {t.title}
              </td>
              <td className="px-4 py-2.5 text-muted">{t.status}</td>
              <td className="px-4 py-2.5 text-muted">{t.sprint ?? '—'}</td>
              <td className="px-4 py-2.5">
                {taskReady(t) ? (
                  <Pill tone="success">Lista</Pill>
                ) : (
                  <Pill tone="warning">{!t.hasDescription && !t.estimated ? 'Sin describir ni estimar' : !t.hasDescription ? 'Sin describir' : 'Sin estimar'}</Pill>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
