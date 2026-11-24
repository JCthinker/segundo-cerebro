import { useEffect, useRef, useState } from 'react'
import type { ActionRun, ApprovalRequest, Item, RunLogEntry } from '@shared/types'
import { serverLabel, serverOf, shortToolName } from '@shared/permissions'
import { dueLabel } from '@shared/plan'
import { toDay } from '@shared/dates'
import { call, useAction, useEvent } from '../api'
import { inlineApprovalRuns, ToolInput, toolAction } from './ApprovalHost'
import { Markdown } from './Markdown'
import { Button, ErrorNote, Icon, Pill, Spinner, textareaCls } from './ui'

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

/** Lo que hace Claude con las herramientas de Claude Code, en palabras normales. */
const BUILTIN: Record<string, string> = {
  Read: 'Lee un archivo',
  Glob: 'Busca archivos',
  Grep: 'Busca dentro de archivos',
  LS: 'Mira una carpeta',
  WebSearch: 'Busca en internet',
  WebFetch: 'Lee una página web',
  Skill: 'Usa una de tus skills',
  TodoWrite: 'Organiza los pasos',
  Task: 'Pide ayuda a otro Claude',
  Agent: 'Pide ayuda a otro Claude',
  Bash: 'Ejecuta una orden en tu ordenador',
  Write: 'Escribe un archivo',
  Edit: 'Edita un archivo',
  MultiEdit: 'Edita un archivo'
}

/** Una línea del progreso, en llano: «Consulta Gmail», «Te ha pedido OK: enviar mensaje en Slack»… */
function progressLine(e: RunLogEntry): string | null {
  if (e.type === 'text') return e.text
  if (!e.toolName) return e.text
  const server = serverOf(e.toolName)
  const short = shortToolName(e.toolName)
  if (server === 'cerebro') return e.type === 'tool' ? (APP_TOOLS[short] ?? 'Trabaja en la app') : null
  if (e.toolName === 'ToolSearch') return null
  if (!server && e.type === 'tool') return BUILTIN[e.toolName] ?? 'Trabaja'
  const where = server ? serverLabel(server) : 'tu ordenador'
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

type Line = { e: RunLogEntry; text: string }
/** Lo que se ve de la conversación: tus mensajes, lo que dice Claude y, entre medias, lo que va haciendo. */
type Block = { kind: 'user'; text: string } | { kind: 'claude'; text: string } | { kind: 'steps'; lines: Line[] } | { kind: 'error'; text: string }

function blocks(run: ActionRun): Block[] {
  const out: Block[] = []
  let saidSinceUser = false
  for (const e of run.log) {
    if (e.type === 'user') {
      out.push({ kind: 'user', text: e.text })
      saidSinceUser = false
    } else if (e.type === 'text') {
      out.push({ kind: 'claude', text: e.text })
      saidSinceUser = true
    } else if (e.type === 'result') {
      // El resumen final repite lo último que dijo: solo se enseña si no dijo nada antes.
      if (!saidSinceUser && e.text.trim()) out.push({ kind: 'claude', text: e.text })
      saidSinceUser = true
    } else if (e.type === 'error') {
      out.push({ kind: 'error', text: e.text })
    } else {
      const text = progressLine(e)
      if (!text) continue
      const last = out.at(-1)
      if (last?.kind === 'steps') last.lines.push({ e, text })
      else out.push({ kind: 'steps', lines: [{ e, text }] })
    }
  }
  return out
}

/** Algo escrito fuera del panel (p. ej. en la caja del dashboard) que se le manda a Claude. */
export interface Incoming {
  text: string
  n: number
}

export function ChatPanel({
  item,
  initialGoal,
  incoming,
  onClose,
  onNew
}: {
  item: Item | null
  initialGoal?: string
  incoming?: Incoming | null
  onClose: () => void
  onNew: () => void
}) {
  const [text, setText] = useState(initialGoal ?? '')
  const [draftsOnly, setDraftsOnly] = useState(false)
  const [run, setRun] = useState<ActionRun | null>(null)
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const bottom = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const runId = run?.id ?? null

  useEvent<ActionRun>('run-updated', (r) => {
    if (r && r.id === runId) setRun(r)
  })
  // Las aprobaciones de esta conversación se piden aquí mismo, no en una tarjeta aparte.
  useEvent<ApprovalRequest>('approval-request', (r) => {
    if (r.runId === runId) setApprovals((q) => [...q, r])
  })
  useEvent<string>('approval-closed', (id) => setApprovals((q) => q.filter((r) => r.id !== id)))
  useEffect(() => {
    if (!runId) return
    inlineApprovalRuns.add(runId)
    return () => {
      inlineApprovalRuns.delete(runId)
      void call('chat.close', runId)
    }
  }, [runId])

  // Siempre a la vista lo último que ha pasado.
  const size = run?.log.length ?? 0
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [size, approvals.length])

  const working = run?.status === 'running'
  const pending = approvals[0]

  const send = useAction(async (typed?: string) => {
    const said = (typed ?? text).trim()
    if (!said && !(item && !run)) return
    if (typed === undefined) setText('')
    if (!run) setRun(await call<ActionRun>('chat.start', item?.id ?? null, said, draftsOnly))
    else await call('chat.send', run.id, said, draftsOnly)
    input.current?.focus()
  })
  // Lo que llega desde fuera se envía tal cual, como si lo hubieras escrito aquí.
  const seen = useRef(0)
  useEffect(() => {
    if (incoming && incoming.n !== seen.current) {
      seen.current = incoming.n
      void send.run(incoming.text)
    }
  }, [incoming, send])
  const answer = (id: string, ok: boolean, always = false) => {
    void call('approvals.answer', id, ok, always)
    setApprovals((q) => q.filter((r) => r.id !== id))
  }

  const status = working
    ? pending
      ? { label: 'Espera tu OK', tone: 'warning' as const }
      : { label: 'Trabajando…', tone: 'clay' as const }
    : run?.status === 'error'
      ? { label: 'Error', tone: 'danger' as const }
      : null
  const lines = run ? blocks(run) : []
  const last = lines.at(-1)
  const now = working && last?.kind === 'steps' ? [...last.lines].reverse().find((l) => l.e.type === 'tool') : undefined

  return (
    <aside className="no-drag flex h-full w-[420px] shrink-0 flex-col border-l border-line bg-raised">
      {/* Cabecera */}
      <div className="flex items-center gap-2 border-b border-line px-4 pt-10 pb-3">
        <Icon name="sparkles" className="text-clay" />
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{item ? item.title : 'Claude'}</h2>
        {status ? <Pill tone={status.tone}>{status.label}</Pill> : null}
        {run ? (
          <button className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink" onClick={onNew} title="Nueva conversación (la de ahora queda en el Historial)">
            <Icon name="plus" />
          </button>
        ) : null}
        <button className="-mr-1 rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink" onClick={onClose} title="Cerrar (lo que pasó queda en el Historial)">
          <Icon name="x" />
        </button>
      </div>

      {/* Conversación */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {item ? <Context item={item} /> : null}
        <div className="mt-5 space-y-4">
          {lines.map((b, i) =>
            b.kind === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-hover px-4 py-2.5 text-[14px] whitespace-pre-wrap">{b.text}</div>
              </div>
            ) : b.kind === 'claude' ? (
              <div key={i} className="font-voice text-[14.5px] leading-relaxed">
                <Markdown text={b.text} />
              </div>
            ) : b.kind === 'error' ? (
              <ErrorNote key={i}>{b.text}</ErrorNote>
            ) : (
              <Steps key={i} lines={b.lines} />
            )
          )}
          {working && !pending ? (
            <div className="flex items-center gap-2 text-[13.5px] text-muted">
              <Spinner /> {now?.text ?? 'Pensando'}…
            </div>
          ) : null}
          {run?.status === 'cancelled' ? <p className="text-[13px] text-faint">Claude se paró aquí. Puedes seguir hablándole.</p> : null}
          {!run ? (
            <p className="text-[13px] text-faint">
              Háblale como en la app de Claude: pídele algo, cuéntale algo para que lo apunte o pregúntale. Siempre te contestará qué ha hecho o qué necesita. Puede usar tu ordenador, internet, tus skills y tus herramientas; antes de enviar o cambiar algo te pedirá el OK aquí mismo.
            </p>
          ) : null}
        </div>
        <div ref={bottom} />
      </div>

      {/* Siempre disponible: aprobar o seguir hablando */}
      <div className="border-t border-line bg-panel px-4 py-3">
        {pending ? (
          <div className="mb-3 rounded-xl border border-warning/40 bg-warning-bg/40 p-4">
            <div className="text-[14px] font-medium">
              ¿{toolAction(pending.toolName).verb} en {pending.serverName ?? 'Claude'}?
            </div>
            <p className="text-[12.5px] text-muted">Esto es lo que va a hacer. No pasa nada hasta que lo apruebes.</p>
            <div className="max-h-[30vh] overflow-y-auto">
              <ToolInput input={pending.input} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              {approvals.length > 1 ? <span className="mr-auto text-[12px] text-faint">{approvals.length - 1} más después</span> : null}
              <Button variant="ghost" onClick={() => answer(pending.id, false)}>
                No
              </Button>
              <Button variant="secondary" onClick={() => answer(pending.id, true, true)} title="No te lo volverá a preguntar mientras dure esta conversación">
                Sí a todo esto
              </Button>
              <Button variant="primary" onClick={() => answer(pending.id, true)}>
                <Icon name="check" /> Sí
              </Button>
            </div>
          </div>
        ) : null}

        <ErrorNote>{send.error}</ErrorNote>
        <textarea
          ref={input}
          autoFocus
          rows={Math.min(8, Math.max(2, text.split('\n').length))}
          className={`${textareaCls} mt-1 text-[14px]`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send.run()
            }
          }}
          placeholder={
            run
              ? working
                ? 'Puedes escribirle mientras trabaja: lo leerá al terminar el paso en curso…'
                : 'Contéstale o pídele algo más…'
              : item
                ? 'Cuéntale cómo quieres que lo haga, o pulsa Intro para que lo resuelva…'
                : 'Pídele algo, cuéntale algo o pregúntale…'
          }
        />
        <div className="mt-2 flex items-center gap-2">
          <label className="flex items-center gap-2 text-[12px] text-muted" title="Prepara correos y mensajes, pero no envía ni cambia nada">
            <input type="checkbox" checked={draftsOnly} onChange={(e) => setDraftsOnly(e.target.checked)} />
            Solo borradores
          </label>
          <div className="ml-auto flex gap-2">
            {working ? (
              <Button variant="danger" onClick={() => run && call('chat.stop', run.id)}>
                Detener
              </Button>
            ) : null}
            <Button variant="claude" busy={send.busy} disabled={!text.trim() && !(item && !run)} onClick={() => send.run()}>
              <Icon name="arrow" /> Enviar
            </Button>
          </div>
        </div>
      </div>
    </aside>
  )
}

/** Lo que va haciendo Claude entre mensaje y mensaje, recogido en una línea que se puede abrir. */
function Steps({ lines }: { lines: Line[] }) {
  const [open, setOpen] = useState(false)
  const marks = lines.filter((l) => LINE_ICON[l.e.type])
  return (
    <div className="text-[12.5px] text-muted">
      <button className="flex items-center gap-1 hover:text-ink" onClick={() => setOpen(!open)}>
        <Icon name="chevron" className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        {lines.length === 1 ? lines[0].text : `${lines.length} pasos`}
      </button>
      {!open && marks.length ? (
        <div className="mt-1 space-y-0.5 pl-4">
          {marks.map(({ e, text }, i) => (
            <div key={i} className="flex gap-2">
              <Icon name={LINE_ICON[e.type]!.icon} className={`mt-0.5 h-3.5 w-3.5 ${LINE_ICON[e.type]!.tone}`} />
              <span>{text}</span>
            </div>
          ))}
        </div>
      ) : null}
      {open ? (
        <div className="mt-1 rounded-lg border border-line px-3 py-1.5">
          {lines.map(({ e, text }, i) => {
            const st = LINE_ICON[e.type]
            return (
              <div key={i} className="flex gap-2 py-0.5">
                {st ? <Icon name={st.icon} className={`mt-0.5 h-3.5 w-3.5 ${st.tone}`} /> : <span className="w-3.5 text-faint">·</span>}
                <span className="min-w-0 flex-1 whitespace-pre-wrap">{text}</span>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/** El contexto de la tarea, grande y legible: es lo que Claude va a usar. */
function Context({ item }: { item: Item }) {
  const today = toDay(new Date())
  const facts = [item.person ? `Con ${item.person}` : null, item.dueDate ? `Vence ${dueLabel(today, item.dueDate)}` : null, item.sourceTool ? `De ${item.sourceTool}` : null].filter(Boolean)
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-1.5 text-[12px] font-medium text-muted">Contexto</div>
      {item.context ? (
        <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{item.context}</p>
      ) : (
        <p className="text-[13px] text-faint">Esta tarea no tiene contexto. Si sabes algo que Claude deba tener en cuenta, escríbelo abajo.</p>
      )}
      {item.sourceSnippet ? <blockquote className="mt-3 border-l-2 border-line-strong pl-3 text-[13.5px] text-muted italic">«{item.sourceSnippet}»</blockquote> : null}
      {facts.length ? <div className="mt-3 text-[12.5px] text-faint">{facts.join(' · ')}</div> : null}
    </div>
  )
}

