import { useState } from 'react'
import type { ActionRun, Item, RunLogEntry } from '@shared/types'
import { call, useAction, useEvent } from '../api'
import { ToolInput } from './ApprovalHost'
import { Button, ErrorNote, Icon, Modal, Pill, Spinner, textareaCls } from './ui'

const ENTRY_STYLE: Record<RunLogEntry['type'], { icon: Parameters<typeof Icon>[0]['name']; tone: string }> = {
  text: { icon: 'sparkles', tone: 'text-clay' },
  tool: { icon: 'tool', tone: 'text-faint' },
  approved: { icon: 'check', tone: 'text-success' },
  denied: { icon: 'x', tone: 'text-danger' },
  draft: { icon: 'file', tone: 'text-warning' },
  result: { icon: 'check', tone: 'text-success' },
  error: { icon: 'x', tone: 'text-danger' }
}

function LogEntry({ e }: { e: RunLogEntry }) {
  const [open, setOpen] = useState(e.type === 'draft')
  const st = ENTRY_STYLE[e.type]
  const tool = e.toolName?.replace(/^mcp__/, '').replace('__', ' · ').replace(/_/g, ' ')
  return (
    <div className="flex gap-2.5 py-1.5">
      <Icon name={st.icon} className={`mt-0.5 ${st.tone}`} />
      <div className="min-w-0 flex-1 text-[13px]">
        {e.type === 'tool' ? (
          <button className="text-left text-muted hover:text-ink" onClick={() => setOpen(!open)}>
            Usa {tool}
          </button>
        ) : e.type === 'result' ? (
          <div className="font-voice text-[14.5px] whitespace-pre-wrap">{e.text}</div>
        ) : e.type === 'text' ? (
          <div className="whitespace-pre-wrap text-muted">{e.text}</div>
        ) : (
          <button className="text-left" onClick={() => setOpen(!open)}>
            {e.text}
          </button>
        )}
        {open && e.input ? <ToolInput input={e.input} /> : null}
      </div>
    </div>
  )
}

export function ResolvePanel({ item, initialGoal, onClose }: { item: Item | null; initialGoal?: string; onClose: () => void }) {
  const [goal, setGoal] = useState(initialGoal ?? '')
  const [run, setRun] = useState<ActionRun | null>(null)
  useEvent<ActionRun>('run-updated', (r) => {
    if (r && run && r.id === run.id) setRun(r)
  })
  const start = useAction(async (mode: 'normal' | 'drafts') => {
    const r = await call<ActionRun>('resolve.start', item?.id ?? null, goal.trim(), mode)
    setRun(r)
  })

  const running = run?.status === 'running'
  const result = run?.log.filter((e) => e.type === 'result').at(-1)
  const steps = run?.log.filter((e) => e.type !== 'result') ?? []

  return (
    <Modal onClose={running ? undefined : onClose} width="max-w-2xl">
      <div className="p-5">
        <div className="flex items-start gap-2">
          <Icon name="sparkles" className="mt-1 text-clay" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold">Resolver{item ? `: «${item.title}»` : ' con Claude'}</h2>
            <p className="text-[12.5px] text-muted">
              Claude busca contexto y actúa con tus herramientas. Lo que escribe o envía sigue tus permisos de Mi flujo.
            </p>
          </div>
          {run ? (
            <Pill tone={run.status === 'done' ? 'success' : run.status === 'error' ? 'danger' : run.status === 'cancelled' ? 'neutral' : 'clay'}>
              {run.status === 'running' ? 'Trabajando…' : run.status === 'done' ? 'Terminado' : run.status === 'error' ? 'Error' : 'Cancelado'}
            </Pill>
          ) : null}
        </div>

        {!run ? (
          <>
            <textarea
              autoFocus
              rows={3}
              className={`${textareaCls} mt-4`}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={item ? 'Opcional: indicaciones extra («adjunta el PDF de la carpeta Informes», «avísale por Slack»…)' : 'Qué quieres que haga Claude'}
            />
            <ErrorNote>{start.error}</ErrorNote>
            <div className="mt-4 flex items-center gap-2">
              <span className="text-[12px] text-faint">«Solo borradores» prepara todo sin enviar nada.</span>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancelar
                </Button>
                <Button busy={start.busy} onClick={() => start.run('drafts')}>
                  Solo borradores
                </Button>
                <Button variant="claude" busy={start.busy} disabled={!item && !goal.trim()} onClick={() => start.run('normal')}>
                  Empezar
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 max-h-[45vh] overflow-y-auto rounded-xl border border-line px-3 py-2">
              {steps.length === 0 ? (
                <div className="flex items-center gap-2 py-2 text-[13px] text-muted">
                  <Spinner /> Preparando…
                </div>
              ) : (
                steps.map((e, i) => <LogEntry key={i} e={e} />)
              )}
              {running && steps.length ? (
                <div className="flex items-center gap-2 py-1.5 text-[12.5px] text-faint">
                  <Spinner /> Trabajando
                </div>
              ) : null}
            </div>
            {result ? (
              <div className="mt-4 rounded-xl bg-panel p-4">
                <LogEntry e={result} />
              </div>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              {running ? (
                <Button variant="danger" onClick={() => call('resolve.cancel', run.id)}>
                  Detener
                </Button>
              ) : (
                <Button variant="primary" onClick={onClose}>
                  Cerrar
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
