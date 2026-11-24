import { useEffect, useRef, useState } from 'react'
import type { ActionRun, ApprovalRequest, Item, ResolvePlan, RunLogEntry, ToolMode } from '@shared/types'
import { serverLabel, serverOf, shortToolName } from '@shared/permissions'
import { buildGoal, isGoAhead } from '@shared/conversation'
import { dueLabel } from '@shared/plan'
import { toDay } from '@shared/dates'
import { call, useAction, useEvent } from '../api'
import { inlineApprovalRuns, ToolInput, toolAction } from './ApprovalHost'
import { Markdown } from './Markdown'
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

const resultOf = (r: ActionRun) => r.log.filter((e) => e.type === 'result').at(-1)

function progressOf(r: ActionRun) {
  const result = resultOf(r)
  return r.log
    .filter((e) => e.type !== 'result' && !(e.type === 'text' && result && e.text.trim() === result.text.trim()))
    .map((e) => ({ e, text: progressLine(e) }))
    .filter((l): l is { e: RunLogEntry; text: string } => !!l.text)
}

/** Lo que dejó hecho una ejecución, para que Claude no lo repita si le pides algo más. */
function doneText(r: ActionRun): string {
  const result = resultOf(r)
  if (result) return result.text
  const lines = progressOf(r).filter((l) => l.e.type !== 'tool')
  return lines.length ? `${lines.map((l) => `- ${l.text}`).join('\n')}\n(Se paró antes de terminar.)` : ''
}

type Stage = 'ask' | 'planning' | 'plan' | 'run'
type Entry = { kind: 'user'; text: string } | { kind: 'plan'; plan: ResolvePlan } | { kind: 'run'; runId: string }

export function ResolvePanel({ item, initialGoal, onClose }: { item: Item | null; initialGoal?: string; onClose: () => void }) {
  const [text, setText] = useState(initialGoal ?? '')
  const [messages, setMessages] = useState<string[]>([])
  const [thread, setThread] = useState<Entry[]>([])
  const [draftsOnly, setDraftsOnly] = useState(false)
  const [stage, setStage] = useState<Stage>('ask')
  const [plan, setPlan] = useState<ResolvePlan | null>(null)
  const [runs, setRuns] = useState<Record<string, ActionRun>>({})
  const [runId, setRunId] = useState<string | null>(null)
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [details, setDetails] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const mode = draftsOnly ? 'drafts' : 'normal'
  const run = runId ? runs[runId] : null

  useEvent<ActionRun>('run-updated', (r) => {
    if (r) setRuns((all) => (all[r.id] ? { ...all, [r.id]: r } : all))
  })
  // Las aprobaciones de esta tarea se piden aquí mismo, no en una tarjeta aparte.
  useEvent<ApprovalRequest>('approval-request', (r) => {
    if (run && r.runId === run.id) setApprovals((q) => [...q, r])
  })
  useEvent<string>('approval-closed', (id) => setApprovals((q) => q.filter((r) => r.id !== id)))
  useEffect(() => {
    if (!runId) return
    inlineApprovalRuns.add(runId)
    return () => {
      inlineApprovalRuns.delete(runId)
    }
  }, [runId])

  // Siempre a la vista lo último que ha pasado.
  const logSize = run?.log.length ?? 0
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [thread.length, logSize, stage, details])

  const running = run?.status === 'running'
  const pending = approvals[0]
  const done = () =>
    thread
      .filter((e): e is Extract<Entry, { kind: 'run' }> => e.kind === 'run')
      .map((e) => (runs[e.runId] ? doneText(runs[e.runId]) : ''))
      .filter(Boolean)
      .join('\n\n')

  /** Lo que escribes abajo: Claude (re)hace el plan teniéndolo en cuenta. */
  const send = useAction(async () => {
    const said = text.trim()
    if (!said && !item && !messages.length) return
    // «Sí», «adelante», «vale»… con un plan delante: se ejecuta, no se vuelve a planear.
    if (stage === 'plan' && plan && isGoAhead(said)) return start.run()
    if (run && running) {
      await call('resolve.cancel', run.id)
      setApprovals([])
    }
    const all = said ? [...messages, said] : messages
    setMessages(all)
    if (said) setThread((t) => [...t, { kind: 'user', text: said }])
    setText('')
    setStage('planning')
    try {
      const p = await call<ResolvePlan>('resolve.plan', item?.id ?? null, buildGoal(all, done()), mode)
      setPlan(p)
      setThread((t) => [...t, { kind: 'plan', plan: p }])
      setStage('plan')
    } catch (e) {
      setStage(run ? 'run' : plan ? 'plan' : 'ask')
      throw e
    }
  })
  // Cuando Claude termina de pensar, el cursor vuelve a la caja para contestarle.
  useEffect(() => {
    if (stage !== 'planning') input.current?.focus()
  }, [stage])
  /** «Hazlo»: ejecuta el plan. Lo que haya escrito abajo (una respuesta, un matiz) va con él, sin rehacer el plan. */
  const start = useAction(async () => {
    const said = text.trim()
    const all = said && !isGoAhead(said) ? [...messages, said] : messages
    if (said) {
      setThread((t) => [...t, { kind: 'user', text: said }])
      setMessages(all)
      setText('')
    }
    const r = await call<ActionRun>('resolve.start', item?.id ?? null, buildGoal(all, done()), mode, plan)
    setRuns((all) => ({ ...all, [r.id]: r }))
    setRunId(r.id)
    setThread((t) => [...t, { kind: 'run', runId: r.id }])
    setDetails(false)
    setStage('run')
  })
  const answer = (id: string, ok: boolean) => {
    void call('approvals.answer', id, ok)
    setApprovals((q) => q.filter((r) => r.id !== id))
  }

  const status =
    stage === 'planning'
      ? { label: 'Pensando…', tone: 'clay' as const }
      : run && stage === 'run'
        ? run.status === 'running'
          ? pending
            ? { label: 'Espera tu OK', tone: 'warning' as const }
            : { label: 'Trabajando…', tone: 'clay' as const }
          : run.status === 'done'
            ? { label: 'Terminado', tone: 'success' as const }
            : run.status === 'error'
              ? { label: 'Error', tone: 'danger' as const }
              : { label: 'Detenido', tone: 'neutral' as const }
        : stage === 'plan'
          ? { label: 'Espera tu OK', tone: 'warning' as const }
          : null

  const lastPlan = thread.map((e, i) => (e.kind === 'plan' ? i : -1)).reduce((a, b) => Math.max(a, b), -1)
  const hasText = !!text.trim()
  const placeholder =
    stage === 'plan'
      ? plan?.question
        ? 'Contesta a Claude y pulsa Intro: se pone a trabajar con tu respuesta…'
        : 'Pulsa Intro o «Hazlo» para que empiece. Si quieres algún matiz, escríbelo y lo tendrá en cuenta…'
      : stage === 'run'
        ? running
          ? 'Si quieres cambiar algo, escríbelo: Claude parará y te propondrá un plan nuevo…'
          : '¿Algo más? Pídeselo aquí…'
        : item
          ? 'Cuéntale a Claude cómo quieres que lo haga («avísale por Slack», «adjunta el informe»…). Es opcional.'
          : '¿Qué quieres que haga Claude?'

  return (
    <Modal full>
      {/* Cabecera */}
      <div className="flex items-start gap-3 border-b border-line px-6 py-4">
        <Icon name="sparkles" className="mt-1 text-clay" />
        <h2 className="min-w-0 flex-1 text-[17px] font-semibold">{item ? item.title : 'Pedir algo a Claude'}</h2>
        {status ? <Pill tone={status.tone}>{status.label}</Pill> : null}
        <button className="-mr-2 rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink" onClick={onClose} title={running ? 'Cerrar (Claude seguirá trabajando)' : 'Cerrar'}>
          <Icon name="x" />
        </button>
      </div>

      {/* Contexto y conversación */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {item ? <Context item={item} /> : null}

        <div className="mt-5 space-y-4">
          {thread.map((e, i) =>
            e.kind === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-hover px-4 py-2.5 text-[14px] whitespace-pre-wrap">{e.text}</div>
              </div>
            ) : e.kind === 'plan' ? (
              <PlanView key={i} plan={e.plan} current={i === lastPlan && stage === 'plan'} />
            ) : runs[e.runId] ? (
              <RunView key={i} run={runs[e.runId]} current={e.runId === runId} details={details} onDetails={() => setDetails(!details)} />
            ) : null
          )}
          {stage === 'planning' ? (
            <div className="flex items-center gap-2 text-[13.5px] text-muted">
              <Spinner /> Claude está mirando qué hace falta. Todavía no toca nada.
            </div>
          ) : null}
          {!thread.length && stage === 'ask' ? (
            <p className="text-[13px] text-faint">Antes de hacer nada, Claude te enseña qué va a hacer y tú decides si sigue.</p>
          ) : null}
        </div>
        <div ref={bottom} />
      </div>

      {/* Siempre disponible: aprobar, contestar o pedir cambios */}
      <div className="border-t border-line bg-panel px-6 py-4">
        {pending ? (
          <div className="mb-3 rounded-xl border border-warning/40 bg-warning-bg/40 p-4">
            <div className="text-[14px] font-medium">
              ¿{toolAction(pending.toolName).verb} en {pending.serverName ?? 'Claude'}?
            </div>
            <p className="text-[12.5px] text-muted">Esto es lo que va a hacer. No pasa nada hasta que lo apruebes.</p>
            <div className="max-h-[30vh] overflow-y-auto">
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
        ) : null}

        <ErrorNote>{send.error ?? start.error}</ErrorNote>
        <textarea
          ref={input}
          autoFocus
          rows={Math.min(8, Math.max(2, text.split('\n').length))}
          disabled={stage === 'planning'}
          className={`${textareaCls} mt-1 text-[14px]`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              // Con un plan delante, lo que escribas va con «Hazlo»: nunca vuelve a planear solo.
              if (stage === 'plan' && plan) void start.run()
              else if (hasText || (stage === 'ask' && item)) void send.run()
            }
          }}
          placeholder={placeholder}
        />
        <div className="mt-2 flex items-center gap-2">
          <label className="flex items-center gap-2 text-[12.5px] text-muted">
            <input type="checkbox" checked={draftsOnly} onChange={(e) => setDraftsOnly(e.target.checked)} disabled={stage === 'planning' || running} />
            Solo dejarlo en borrador, sin enviar nada
          </label>
          <div className="ml-auto flex gap-2">
            {stage === 'planning' ? null : stage === 'plan' ? (
              <>
                {hasText && !isGoAhead(text) ? (
                  <Button variant="secondary" busy={send.busy} disabled={start.busy} onClick={() => send.run()}>
                    <Icon name="refresh" /> Rehacer el plan
                  </Button>
                ) : null}
                <Button variant="claude" busy={start.busy} disabled={send.busy} onClick={() => start.run()}>
                  <Icon name="check" /> Hazlo
                </Button>
              </>
            ) : hasText ? (
              <Button variant="claude" busy={send.busy} onClick={() => send.run()}>
                <Icon name="arrow" /> {running ? 'Parar y cambiar el plan' : 'Ver qué hará'}
              </Button>
            ) : stage === 'ask' ? (
              <Button variant="claude" busy={send.busy} disabled={!item} onClick={() => send.run()}>
                Ver qué hará
              </Button>
            ) : running ? (
              <Button variant="danger" onClick={() => run && call('resolve.cancel', run.id)}>
                Detener
              </Button>
            ) : (
              <Button variant="primary" onClick={onClose}>
                Cerrar
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** El contexto de la tarea, grande y legible: es lo que Claude va a usar. */
function Context({ item }: { item: Item }) {
  const today = toDay(new Date())
  const facts = [item.person ? `Con ${item.person}` : null, item.dueDate ? `Vence ${dueLabel(today, item.dueDate)}` : null, item.sourceTool ? `De ${item.sourceTool}` : null].filter(Boolean)
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="mb-2 text-[12px] font-medium text-muted">Contexto</div>
      {item.context ? (
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{item.context}</p>
      ) : (
        <p className="text-[14px] text-faint">Esta tarea no tiene contexto. Si sabes algo que Claude deba tener en cuenta, escríbelo abajo.</p>
      )}
      {item.sourceSnippet ? <blockquote className="mt-3 border-l-2 border-line-strong pl-3 text-[13.5px] text-muted italic">«{item.sourceSnippet}»</blockquote> : null}
      {facts.length ? <div className="mt-3 text-[12.5px] text-faint">{facts.join(' · ')}</div> : null}
    </div>
  )
}

function PlanView({ plan, current }: { plan: ResolvePlan; current: boolean }) {
  if (!current)
    return (
      <div className="rounded-xl border border-line px-4 py-3 text-[13px] text-muted">
        <span className="font-medium">Plan propuesto:</span> {plan.summary}
      </div>
    )
  return (
    <div className="rounded-xl border border-clay/40 p-5">
      <div className="mb-1 text-[12px] font-medium text-clay">Lo que va a hacer Claude</div>
      <p className="font-voice text-[16px] leading-relaxed">{plan.summary}</p>
      <ol className="mt-3 space-y-1.5">
        {plan.steps.map((st, i) => (
          <li key={i} className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5 text-[14px]">
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
        <div className="mt-3 rounded-lg bg-warning-bg px-3 py-2.5 text-[14px] text-warning">
          <span className="font-medium">Claude te pregunta:</span> {plan.question} Contéstale abajo y pulsa «Hazlo»: lo hará con tu respuesta.
        </div>
      ) : null}
      <p className="mt-3 text-[12.5px] text-faint">
        {plan.steps.some((s) => s.effect === 'ask')
          ? 'Lo que dice «Te pedirá OK» no se hará hasta que lo apruebes aquí mismo. '
          : plan.steps.some((s) => s.kind === 'write' && s.effect === 'auto')
            ? 'Lo que dice «Lo hace solo» se hará directamente, porque así lo tienes en Mi flujo. '
            : 'No va a enviar ni cambiar nada en tus herramientas. '}
        Pulsa «Hazlo» para que empiece. Lo que le escribas abajo lo tendrá en cuenta al hacerlo.
      </p>
    </div>
  )
}

function RunView({ run, current, details, onDetails }: { run: ActionRun; current: boolean; details: boolean; onDetails: () => void }) {
  const result = resultOf(run)
  const lines = progressOf(run)
  const now = [...lines].reverse().find((l) => l.e.type === 'tool')
  return (
    <div className="space-y-3">
      {run.status === 'running' ? (
        <div className="flex items-center gap-2 rounded-xl bg-panel px-4 py-3 text-[14px]">
          <Spinner /> {now?.text ?? 'Empezando'}…
        </div>
      ) : run.status === 'cancelled' ? (
        <div className="text-[13px] text-faint">Claude se paró aquí.</div>
      ) : null}
      {result ? (
        <div className="rounded-xl bg-panel p-5">
          <div className="mb-1 text-[12px] font-medium text-muted">Qué ha hecho</div>
          <div className="font-voice text-[15px] leading-relaxed">
            <Markdown text={result.text} />
          </div>
        </div>
      ) : null}
      {run.status === 'error' ? <ErrorNote>{[...run.log].reverse().find((e) => e.type === 'error')?.text ?? 'Algo ha fallado.'}</ErrorNote> : null}
      {current && lines.length ? (
        <div>
          <button className="text-[12px] text-faint hover:text-ink" onClick={onDetails}>
            {details ? 'Ocultar pasos' : `Ver pasos (${lines.length})`}
          </button>
          {details ? (
            <div className="mt-1 rounded-lg border border-line px-3 py-1.5">
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
    </div>
  )
}
