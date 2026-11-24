import { ROAD_NOTE_LABEL, type PathStep, type RoadNote } from '@shared/initiative'
import type { JiraInitiative } from '@shared/jira'
import type { MeasureRow } from '@shared/measure'
import type { SprintRow } from '@shared/sprint'
import { parseDay } from '@shared/dates'
import { call, useData } from '../api'
import { useNav } from '../nav'
import { setScreenDetail } from '../screen'
import { useEffect } from 'react'
import { Button, ErrorNote, Icon, Modal, Pill } from './ui'

interface Sheet {
  initiative: JiraInitiative
  path: PathStep[]
  nextStep: string
  work: SprintRow
  measure: MeasureRow | null
  roadNotes: RoadNote[]
  notes: { id: string; title: string }[]
}

const open = (url: string | null) => {
  if (url) void call('shell.open', url)
}

/** Ficha de una iniciativa: en qué paso está, qué le toca, sus FP y épica, KPI y conclusiones. */
export function InitiativeSheet({ jiraKey, onClose }: { jiraKey: string; onClose: () => void }) {
  const { data, error } = useData<Sheet | null>('initiative.get', [jiraKey], ['jira'])
  const { talk, go } = useNav()
  useEffect(() => {
    setScreenDetail(`ficha de la iniciativa ${jiraKey}`)
    return () => setScreenDetail(null)
  }, [jiraKey])

  const i = data?.initiative
  const pending = data?.roadNotes.filter((n) => !n.registered) ?? []

  return (
    <Modal onClose={onClose} width="max-w-3xl">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {data === null ? <p className="p-6 text-[13px] text-muted">Esta iniciativa ya no está en la copia de Jira.</p> : null}
      {i && data ? (
        <>
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-faint">
                {i.key}
                {i.quarter ? ` · ${i.quarter}` : ''}
                {i.developers.length ? ` · ${i.developers.join(', ')}` : ''}
              </div>
              <div className="text-[18px] font-semibold tracking-tight">{i.title}</div>
              <div className="mt-1 text-[13px]">
                <span className="text-muted">KPI: </span>
                {i.kpi ?? data.measure?.plan.kpi ?? <span className="text-warning">sin KPI en Jira</span>}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => open(i.url)}>
              Abrir en Jira
            </Button>
            <button className="text-faint hover:text-ink" onClick={onClose} aria-label="Cerrar">
              <Icon name="x" />
            </button>
          </div>

          <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-4">
            <div>
              <div className="flex flex-wrap items-center gap-1">
                {data.path.map((s, n) => (
                  <span key={s.id} className="flex items-center gap-1">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[12px] ${
                        s.state === 'current' ? 'bg-clay font-medium text-clay-ink' : s.state === 'done' ? 'bg-hover text-muted' : 'text-faint'
                      }`}
                    >
                      {s.state === 'done' ? '✓ ' : ''}
                      {s.label}
                    </span>
                    {n < data.path.length - 1 ? <span className="text-faint">›</span> : null}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-clay/30 bg-clay/5 px-3 py-2.5">
                <Icon name="sparkles" className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
                <div className="min-w-0 flex-1 text-[13.5px]">{data.nextStep}</div>
                <Button
                  size="sm"
                  variant="claude"
                  onClick={() => {
                    onClose()
                    talk(`Ayúdame con la iniciativa ${i.key} «${i.title}» (${i.status}). Lo siguiente es: ${data.nextStep} Busca contexto en Jira, en mis notas y en las transcripciones de Google Drive, y pídeme OK antes de escribir nada.`)
                  }}
                >
                  Hacer con Claude
                </Button>
              </div>
            </div>

            <Section title={`Conclusiones${pending.length ? ` · ${pending.length} sin registrar en ROAD` : ''}`}>
              {data.roadNotes.length ? (
                <>
                  <ul className="space-y-1.5">
                    {data.roadNotes.map((n) => (
                      <li key={n.id} className="flex items-start gap-2 text-[13px]">
                        <Pill tone={n.registered ? 'success' : 'warning'}>{n.registered ? 'En ROAD' : 'Sin registrar'}</Pill>
                        <span className="min-w-0 flex-1">
                          <span className="text-faint">{ROAD_NOTE_LABEL[n.tag] ?? n.tag} · </span>
                          {n.text}
                          {n.noteTitle ? <span className="text-faint"> — {n.noteTitle}</span> : null}
                        </span>
                        <button className="shrink-0 text-[12px] text-muted hover:text-ink hover:underline" onClick={() => call('roadnotes.mark', n.id, !n.registered)}>
                          {n.registered ? 'Desmarcar' : 'Ya está en ROAD'}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {pending.length ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2"
                      onClick={() => {
                        onClose()
                        talk(
                          `Registra en ${i.key} «${i.title}» estas conclusiones como comentario:\n${pending.map((n) => `- ${ROAD_NOTE_LABEL[n.tag] ?? n.tag}: ${n.text}`).join('\n')}\nEnséñame el comentario y pídeme OK antes de escribirlo.`
                        )
                      }}
                    >
                      <Icon name="sparkles" className="text-clay" /> Registrar con Claude
                    </Button>
                  ) : null}
                </>
              ) : (
                <p className="text-[12.5px] text-faint">Aún no hay conclusiones. Salen de «Revisar y repartir» en las notas de reunión.</p>
              )}
            </Section>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Section title="Tareas FP">
                {data.work.tasks.length || data.work.unknownTasks.length ? (
                  <ul className="space-y-1 text-[12.5px]">
                    {data.work.tasks.map((t) => (
                      <li key={t.key} className="flex items-center gap-2">
                        <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => open(t.url)}>
                          <span className="mr-1.5 text-faint">{t.key}</span>
                          {t.title}
                        </button>
                        <span className="shrink-0 text-[11.5px] text-faint">{t.status}</span>
                        {t.ready ? null : <Pill tone="warning">{!t.hasDescription ? 'Sin describir' : 'Sin estimar'}</Pill>}
                      </li>
                    ))}
                    {data.work.unknownTasks.map((k) => (
                      <li key={k} className="text-faint">
                        {k} · no está en la copia de FP
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12.5px] text-faint">Sin tareas FP.</p>
                )}
              </Section>
              <Section title="Épica">
                {data.work.epic ? (
                  <div className="text-[12.5px]">
                    <button className="hover:underline" onClick={() => open(data.work.epic!.url)}>
                      {data.work.epic.key}
                    </button>
                    {!data.work.epic.missing.length && !data.work.epic.extra.length ? <span className="ml-2 text-success">Igual que la iniciativa</span> : null}
                    {data.work.epic.missing.length ? <div className="text-warning">Faltan: {data.work.epic.missing.join(', ')}</div> : null}
                    {data.work.epic.extra.length ? <div className="text-warning">Sobran: {data.work.epic.extra.join(', ')}</div> : null}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-faint">Sin épica.</p>
                )}
              </Section>
            </div>

            {data.measure ? (
              <Section title="Medición">
                <p className="text-[13px]">
                  {data.measure.result ? (
                    <>
                      <span className="text-success">Medido:</span> {data.measure.result.text}
                    </>
                  ) : (
                    <>
                      Medir el {parseDay(data.measure.plan.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
                      <span className="text-faint"> · {data.measure.plan.why}</span>
                    </>
                  )}
                </p>
              </Section>
            ) : null}

            <Section title="Notas">
              {data.notes.length ? (
                <ul className="space-y-1 text-[13px]">
                  {data.notes.map((n) => (
                    <li key={n.id}>
                      <button
                        className="hover:underline"
                        onClick={() => {
                          onClose()
                          go('notes', n.id)
                        }}
                      >
                        <Icon name="notes" className="mr-1.5 inline h-3.5 w-3.5 text-faint" />
                        {n.title || 'Sin título'}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-faint">Ninguna nota la menciona todavía.</p>
              )}
            </Section>
          </div>
        </>
      ) : null}
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11.5px] font-medium tracking-wide text-faint uppercase">{title}</div>
      {children}
    </div>
  )
}
