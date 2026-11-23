import { useEffect, useState } from 'react'
import type { ActionRun, ApprovalRequest, Item, ResolvePlan, RunLogEntry, ToolMode } from '@shared/types'
import { serverLabel, serverOf, shortToolName } from '@shared/permissions'
import { call, useAction, useEvent } from '../api'
import { inlineApprovalRuns, ToolInput, toolAction } from './ApprovalHost'
import { Button, ErrorNote, Icon, Modal, Pill, Spinner, textareaCls } from './ui'

/** Qué pasará con cada paso, dicho en llano. */
const EFFECT: Record<ToolMode, { label: string; tone: 'success' | 'warning' | 'info' | 'danger' }> = {
  auto: { label: 'Lo hace solo', tone: 'success' },
  ask: { label: 'Te pedirá OK', tone: 'warning' },
  draft: { label: 'Queda en borrador', tone: 'info' },
  deny: { label: 'No lo hará', tone: 'danger' }
}

/** Lo que hace la app por dentro, en palabras normales. */
const APP_TOOLS: Record<string, string> = {
  search_notes: 'Busca en tus notas',
  get_note: 'Lee una nota',
  list_items: 'Revisa tus tareas',
  get_events: 'Mira tu agenda',
  get_workflow: 'Lee Mi flujo',
  update_item: 'Actualiza la tarea',
  add_item: 'Apunta una tarea'
}

/** Una línea del progreso, en llano: «Consulta Gmail», «Te ha pedido OK: enviar mensaje en Slack»… */
function progressLine(e: RunLogEntry): string | null {
  if (e.type === 'text') return e.text
  if (!e.toolName) return e.text
  const server = serverOf(e.toolName)
  const short = shortToolName(e.toolName)
  if (server === 'cerebro') return e.type === 'tool' ? (APP_TOOLS[short] ?? 'Trabaja en la app') : null
  const where = server ? serverLabel(server) : 'Claude'
  const what = toolAction(e.toolName)
  if (e.type === 'tool') return what.read ? `Consulta ${where}` : `${what.verb} en ${where}`
  if (e.type === 'approved') return `Aprobado: ${what.verb.toLowerCase()} en ${where}`
  if (e.type === 'denied') return `No se hizo: ${what.verb.toLowerCase()} en ${where}`
  if (e.type === 'draft') return `Borrador preparado: ${what.verb.toLowerCase()} en ${where}`
  return e.text
}

const LINE_ICON: Partial<Record<RunLogEntry['type'], { icon: Parameters<typeof Icon>[0]['name']; tone: string }>> = {
  approved: { icon: 'check', tone: 'text-success' },
  denied: { icon: 'x', tone: 'text-danger' },
  draft: { icon: 'file', tone: 'text-warning' },
  error: { icon: 'x', tone: 'text-danger' }
}

type Stage = 'ask' | 'planning' | 'plan' | 'run'

export function ResolvePanel({ item, initialGoal, onClose }: { item: Item | null; initialGoal?: string; onClose: () => void }) {
  const [goal, setGoal] = useState(initialGoal ?? '')
  const [draftsOnly, setDraftsOnly] = useState(false)
  const [stage, setStage] = useState<Stage>('ask')
  const [plan, setPlan] = useState<ResolvePlan | null>(null)
  const [run, setRun] = useState<ActionRun | null>(null)
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [details, setDetails] = useState(false)
  const mode = draftsOnly ? 'drafts' : 'normal'

  useEvent<ActionRun>('run-updated', (r) => {
    if (r && run && r.id === run.id) setRun(r)
  })
  // Las aprobaciones de esta tarea se piden aquí mismo, no en una tarjeta aparte.
  useEvent<ApprovalRequest>('approval-request', (r) => {
    if (run && r.runId === run.id) setApprovals((q) => [...q, r])
  })
  useEvent<string>('approval-closed', (id) => setApprovals((q) => q.filter((r) => r.id !== id)))
  useEffect(() => {
    if (!run) return
    inlineApprovalRuns.add(run.id)
    return () => {
      inlineApprovalRuns.delete(run.id)
    }
  }, [run?.id])

  const makePlan = useAction(async () => {
    setStage('planning')
    try {
      setPlan(await call<ResolvePlan>('resolve.plan', item?.id ?? null, goal.trim(), mode))
      setStage('plan')
    } catch (e) {
      setStage('ask')
      throw e
    }
  })
  const start = useAction(async () => {
    const r = await call<ActionRun>('resolve.start', item?.id ?? null, goal.trim(), mode, plan)
    setRun(r)
    setStage('run')
  })
  const answer = (id: string, ok: boolean) => {
    void call('approvals.answer', id, ok)
    setApprovals((q) => q.filter((r) => r.id !== id))
  }

  const running = run?.status === 'running'
  const result = run?.log.filter((e) => e.type === 'result').at(-1)
  const lines = (run?.log ?? [])
    .filter((e) => e.type !== 'result' && !(e.type === 'text' && result && e.text.trim() === result.text.trim()))
    .map((e) => ({ e, text: progressLine(e) }))
    .filter((l): l is { e: RunLogEntry; text: string } => !!l.text)
  const current = [...lines].reverse().find((l) => l.e.type === 'tool')
  const pending = approvals[0]
  const status = run
    ? run.status === 'running'
      ? pending
        ? { label: 'Espera tu OK', tone: 'warning' as const }
        : { label: 'Trabajando…', tone: 'clay' as const }
      : run.status === 'done'
        ? { label: 'Terminado', tone: 'success' as const }
        : run.status === 'error'
          ? { label: 'Error', tone: 'danger' as const }
          : { label: 'Detenido', tone: 'neutral' as const }
    : null

  return (
    <Modal onClose={running || stage === 'planning' ? undefined : onClose} width="max-w-2xl">
      <div className="p-5">
        <div className="flex items-start gap-2">
          <Icon name="sparkles" className="mt-1 text-clay" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold">{item ? item.title : 'Pedir algo a Claude'}</h2>
            {item?.context ? <p className="text-[12.5px] text-muted">{item.context}</p> : null}
          </div>
          {status ? <Pill tone={status.tone}>{status.label}</Pill> : null}
        </div>

        {/* 1. Qué quieres */}
        {stage === 'ask' || stage === 'planning' ? (
          <>
            <textarea
              autoFocus
              rows={3}
              disabled={stage === 'planning'}
              className={`${textareaCls} mt-4`}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (item || goal.trim())) void makePlan.run()
              }}
              placeholder={item ? 'Opcional: cómo quieres que lo haga («avísale por Slack», «adjunta el informe»…)' : '¿Qué quieres que haga Claude?'}
            />
            <label className="mt-2 flex items-center gap-2 text-[12.5px] text-muted">
              <input type="checkbox" checked={draftsOnly} onChange={(e) => setDraftsOnly(e.target.checked)} disabled={stage === 'planning'} />
              Solo dejarlo preparado en borrador, sin enviar nada
            </label>
            <ErrorNote>{makePlan.error}</ErrorNote>
            <div className="mt-4 flex items-center gap-2">
              {stage === 'planning' ? (
                <span className="flex items-center gap-2 text-[12.5px] text-muted">
                  <Spinner /> Claude está mirando qué hace falta. Todavía no toca nada.
                </span>
              ) : (
                <span className="text-[12px] text-faint">Antes de hacer nada, Claude te enseña qué va a hacer.</span>
              )}
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={onClose} disabled={stage === 'planning'}>
                  Cancelar
                </Button>
                <Button variant="claude" busy={stage === 'planning'} disabled={!item && !goal.trim()} onClick={() => makePlan.run()}>
                  Ver qué hará
                </Button>
              </div>
            </div>
          </>
        ) : null}

        {/* 2. Lo que va a pasar */}
        {stage === 'plan' && plan ? (
          <>
            <p className="font-voice mt-4 text-[15.5px] leading-relaxed">{plan.summary}</p>
            <ol className="mt-3 space-y-1.5">
              {plan.steps.map((st, i) => (
                <li key={i} className="flex items-start gap-3 rounded-lg border border-line px-3 py-2 text-[13.5px]">
                  <span className="w-4 shrink-0 font-semibold text-faint">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    {st.text}
                    {st.tool ? <span className="text-faint"> · {st.tool}</span> : null}
                  </span>
                  <Pill tone={EFFECT[st.effect].tone}>{EFFECT[st.effect].label}</Pill>
                </li>
              ))}
            </ol>
            {plan.question ? (
              <div className="mt-3 rounded-lg bg-warning-bg px-3 py-2 text-[13px] text-warning">
                <span className="font-medium">Antes de empezar:</span> {plan.question} Añádelo en «Cambiar» y vuelve a pedirlo.
              </div>
            ) : null}
            <p className="mt-3 text-[12px] text-faint">
              {plan.steps.some((s) => s.effect === 'ask')
                ? 'Lo que dice «Te pedirá OK» no se hará hasta que lo apruebes aquí mismo.'
                : plan.steps.some((s) => s.kind === 'write' && s.effect === 'auto')
                  ? 'Lo que dice «Lo hace solo» se hará directamente, porque así lo tienes en Mi flujo.'
                  : 'No va a enviar ni cambiar nada en tus herramientas.'}
            </p>
            <ErrorNote>{start.error}</ErrorNote>
            <div className="mt-4 flex items-center gap-2">
              <Button variant="ghost" onClick={() => setStage('ask')}>
                Cambiar
              </Button>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancelar
                </Button>
                <Button variant="claude" busy={start.busy} onClick={() => start.run()}>
                  <Icon name="check" /> Hazlo
                </Button>
              </div>
            </div>
          </>
        ) : null}

        {/* 3. Haciéndolo */}
        {stage === 'run' && run ? (
          <>
            {pending ? (
              <div className="mt-4 rounded-xl border border-warning/40 bg-warning-bg/40 p-4">
                <div className="text-[14px] font-medium">
                  ¿{toolAction(pending.toolName).verb} en {pending.serverName ?? 'Claude'}?
                </div>
                <p className="text-[12.5px] text-muted">Esto es lo que va a hacer. No pasa nada hasta que lo apruebes.</p>
                <div className="max-h-[35vh] overflow-y-auto">
                  <ToolInput input={pending.input} />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {approvals.length > 1 ? <span className="text-[12px] text-faint">{approvals.length - 1} más después</span> : null}
                  <div className="ml-auto flex gap-2">
                    <Button variant="ghost" onClick={() => answer(pending.id, false)}>
                      No, déjalo en borrador
                    </Button>
                    <Button variant="primary" onClick={() => answer(pending.id, true)}>
                      <Icon name="check" /> Sí, hazlo
                    </Button>
                  </div>
                </div>
              </div>
            ) : running ? (
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-panel px-4 py-3 text-[13.5px]">
                <Spinner /> {current?.text ?? 'Empezando'}…
              </div>
            ) : null}

            {result ? (
              <div className="mt-4 rounded-xl bg-panel p-4">
                <div className="mb-1 text-[12px] font-medium text-muted">Qué ha hecho</div>
                <div className="font-voice text-[14.5px] whitespace-pre-wrap">{result.text}</div>
              </div>
            ) : null}
            {run.status === 'error' ? (
              <ErrorNote>{[...run.log].reverse().find((e) => e.type === 'error')?.text ?? 'Algo ha fallado.'}</ErrorNote>
            ) : null}

            {lines.length ? (
              <div className="mt-3">
                <button className="text-[12px] text-faint hover:text-ink" onClick={() => setDetails(!details)}>
                  {details ? 'Ocultar pasos' : `Ver pasos (${lines.length})`}
                </button>
                {details ? (
                  <div className="mt-1 max-h-[30vh] overflow-y-auto rounded-lg border border-line px-3 py-1.5">
                    {lines.map(({ e, text }, i) => {
                      const st = LINE_ICON[e.type]
                      return (
                        <div key={i} className="flex gap-2 py-1 text-[12.5px] text-muted">
                          {st ? <Icon name={st.icon} className={`mt-0.5 h-3.5 w-3.5 ${st.tone}`} /> : <span className="w-3.5 text-faint">·</span>}
                          <span className="min-w-0 flex-1 whitespace-pre-wrap">{text}</span>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
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
        ) : null}
      </div>
    </Modal>
  )
}
