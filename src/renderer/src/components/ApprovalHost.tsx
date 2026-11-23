import { useState } from 'react'
import type { ApprovalRequest } from '@shared/types'
import { isReadOnlyTool, shortToolName } from '@shared/permissions'
import { call, useEvent } from '../api'
import { Button, Icon, Pill } from './ui'

/** Tareas cuya ventana de «Pedir algo» está abierta: sus aprobaciones se piden allí, no aquí. */
export const inlineApprovalRuns = new Set<string>()

const VERBS: [RegExp, string][] = [
  [/send|post|reply|forward/, 'Enviar'],
  [/draft/, 'Crear un borrador'],
  [/create|add|new/, 'Crear'],
  [/update|edit|set|move|transition|assign/, 'Cambiar'],
  [/comment/, 'Comentar'],
  [/delete|remove|trash/, 'Borrar'],
  [/invite|share/, 'Compartir'],
  [/schedule/, 'Programar'],
  [/archive|close/, 'Archivar']
]

const NOUNS: [RegExp, string][] = [
  [/message|chat/, 'un mensaje'],
  [/mail|email|thread/, 'un correo'],
  [/issue|ticket/, 'un ticket'],
  [/event|meeting/, 'un evento'],
  [/comment/, 'un comentario'],
  [/page|doc|file/, 'un documento'],
  [/task/, 'una tarea']
]

/** «send_message» → «Enviar un mensaje». */
export function toolAction(toolName: string): { verb: string; read: boolean } {
  const short = shortToolName(toolName).toLowerCase()
  const verb = VERBS.find(([re]) => re.test(short))?.[1]
  const noun = NOUNS.find(([re]) => re.test(short))?.[1]
  if (!verb) return { verb: short.replace(/_/g, ' '), read: isReadOnlyTool(toolName) }
  return { verb: verb === 'Crear un borrador' ? verb : `${verb}${noun ? ' ' + noun : ''}`, read: isReadOnlyTool(toolName) }
}

const FIELD: Record<string, string> = {
  to: 'Para', recipient: 'Para', recipients: 'Para', cc: 'Copia', bcc: 'Copia oculta',
  subject: 'Asunto', title: 'Título', summary: 'Resumen',
  body: 'Texto', text: 'Texto', message: 'Mensaje', content: 'Contenido', description: 'Descripción',
  channel: 'Canal', channel_id: 'Canal', thread_ts: 'Hilo', project: 'Proyecto', issue: 'Ticket', issueKey: 'Ticket'
}

/** Muestra lo que va a hacer, campo a campo y con nombres en español cuando se conocen. */
export function ToolInput({ input }: { input: unknown }) {
  if (!input || typeof input !== 'object') return null
  const entries = Object.entries(input as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (!entries.length) return null
  return (
    <dl className="mt-2 space-y-1.5 rounded-lg bg-hover p-3 text-[12.5px]">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="text-faint">{FIELD[k] ?? k.replace(/_/g, ' ')}</dt>
          <dd className="whitespace-pre-wrap break-words">{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Tarjeta de aprobación para lo que Claude quiere hacer fuera de la ventana de «Pedir algo» (p. ej. al preguntar). */
export function ApprovalHost() {
  const [queue, setQueue] = useState<ApprovalRequest[]>([])
  useEvent<ApprovalRequest>('approval-request', (r) => setQueue((q) => [...q, r]))
  useEvent<string>('approval-closed', (id) => setQueue((q) => q.filter((r) => r.id !== id)))

  const answer = (id: string, ok: boolean) => {
    void call('approvals.answer', id, ok)
    setQueue((q) => q.filter((r) => r.id !== id))
  }

  const visible = queue.filter((r) => !inlineApprovalRuns.has(r.runId))
  if (!visible.length) return null
  const r = visible[0]
  return (
    <div className="fixed right-5 bottom-5 z-50 w-[420px] rounded-2xl border border-line-strong bg-raised p-4 shadow-2xl">
      <div className="flex items-center gap-2">
        <Icon name="sparkles" className="text-clay" />
        <span className="font-medium">
          ¿{toolAction(r.toolName).verb} en {r.serverName ?? 'Claude'}?
        </span>
        <Pill tone="warning" className="ml-auto">
          Espera tu OK
        </Pill>
      </div>
      <p className="mt-1 text-[12.5px] text-muted">No pasa nada hasta que lo apruebes.</p>
      <div className="max-h-[40vh] overflow-y-auto">
        <ToolInput input={r.input} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        {visible.length > 1 ? <span className="text-[12px] text-faint">{visible.length - 1} más después</span> : null}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={() => answer(r.id, false)}>
            No
          </Button>
          <Button variant="primary" onClick={() => answer(r.id, true)}>
            <Icon name="check" /> Sí, hazlo
          </Button>
        </div>
      </div>
    </div>
  )
}
