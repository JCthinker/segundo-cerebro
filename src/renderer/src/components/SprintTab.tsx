import type { JiraSnapshot } from '@shared/jira'
import { nextMeeting } from '@shared/flow'
import { sprintGoal, sprintRows } from '@shared/sprint'
import type { TodayView } from '@shared/types'
import { call, useData } from '../api'
import { useNav } from '../nav'
import { Button, Card, Icon, Pill } from './ui'

const open = (url: string | null) => {
  if (url) void call('shell.open', url)
}

/** Preparar la sprint planning: tareas FP listas y épicas iguales a su iniciativa. */
export function SprintTab({ snap }: { snap: JiraSnapshot }) {
  const { talk, openInitiative } = useNav()
  const { data: today } = useData<TodayView>('today.get', [], ['events'])
  const rows = sprintRows(snap, new Date())
  const planning = today ? nextMeeting(today.events, /sprint\s*planning|planning|planificaci/i, new Date()) : null
  const ready = rows.filter((r) => r.ready).length

  return (
    <div>
      <Card className="mb-4 border-clay/30 bg-clay/5 px-5 py-4">
        <div className="text-[11.5px] font-medium tracking-wide text-clay uppercase">
          {planning ? `Sprint planning · ${new Date(planning.start).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}` : 'Próxima sprint planning'}
        </div>
        <p className="mt-1 text-[14px]">{sprintGoal(rows)}</p>
        <p className="mt-1 text-[12.5px] text-muted">
          {rows.length ? `${ready} de ${rows.length} iniciativas listas: con sus FP descritas y estimadas y la épica igual que la iniciativa.` : ''}
        </p>
      </Card>

      {rows.map((r) => (
        <Card key={r.key} className="mb-3 px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <button className="text-left hover:underline" onClick={() => openInitiative(r.key)}>
                <span className="mr-2 text-[12px] text-faint">{r.key}</span>
                <span className="font-medium">{r.title}</span>
              </button>
              <div className="mt-0.5 text-[12px] text-faint">
                {r.status}
                {r.quarter ? ` · ${r.quarter}` : ''}
                {r.currentQuarter ? ' · este trimestre' : ''}
              </div>
            </div>
            {r.ready ? (
              <Pill tone="success">Lista</Pill>
            ) : (
              <Button
                size="sm"
                variant="claude"
                onClick={() =>
                  talk(
                    `Prepara para la sprint planning la iniciativa ${r.key} «${r.title}». Le falta: ${r.problems.join('; ')}. Revisa sus tareas en FP (descripción y estimación) y que su épica tenga exactamente las mismas tareas. Enséñame qué vas a cambiar y pídeme OK antes de escribir en Jira.`
                  )
                }
              >
                <Icon name="sparkles" /> Arreglar con Claude
              </Button>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-[11.5px] font-medium tracking-wide text-faint uppercase">Tareas FP</div>
              {r.tasks.length || r.unknownTasks.length ? (
                <ul className="space-y-1 text-[12.5px]">
                  {r.tasks.map((t) => (
                    <li key={t.key} className="flex items-center gap-2">
                      <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => open(t.url)}>
                        <span className="mr-1.5 text-faint">{t.key}</span>
                        {t.title}
                      </button>
                      {t.ready ? (
                        <Pill tone="success">Lista</Pill>
                      ) : (
                        <Pill tone="warning">{!t.hasDescription && !t.estimated ? 'Sin describir ni estimar' : !t.hasDescription ? 'Sin describir' : 'Sin estimar'}</Pill>
                      )}
                    </li>
                  ))}
                  {r.unknownTasks.map((k) => (
                    <li key={k} className="text-faint">
                      {k} · no está en la copia de FP
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-danger">Sin tareas</p>
              )}
            </div>
            <div>
              <div className="mb-1 text-[11.5px] font-medium tracking-wide text-faint uppercase">Épica</div>
              {r.epic ? (
                <div className="text-[12.5px]">
                  <button className="hover:underline" onClick={() => open(r.epic!.url)}>
                    {r.epic.key}
                  </button>
                  {!r.epic.missing.length && !r.epic.extra.length ? <span className="ml-2 text-success">Igual que la iniciativa</span> : null}
                  {r.epic.missing.length ? <div className="text-warning">Faltan: {r.epic.missing.join(', ')}</div> : null}
                  {r.epic.extra.length ? <div className="text-warning">Sobran: {r.epic.extra.join(', ')}</div> : null}
                </div>
              ) : (
                <p className="text-[12.5px] text-warning">No tiene épica</p>
              )}
            </div>
          </div>
        </Card>
      ))}
      {!rows.length ? <p className="py-6 text-center text-[13px] text-muted">No hay iniciativas en Ready to dev ni en WIP.</p> : null}
    </div>
  )
}
