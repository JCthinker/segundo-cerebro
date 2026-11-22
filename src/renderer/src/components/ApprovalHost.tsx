import { useState } from 'react'
import type { ApprovalRequest } from '@shared/types'
import { call, useEvent } from '../api'
import { Button, Icon, Pill } from './ui'

function shortName(toolName: string): string {
  return toolName.replace(/^mcp__.+?__/, '').replace(/_/g, ' ')
}

/** Muestra la entrada de una herramienta de forma legible (campos de texto largos, como un borrador). */
export function ToolInput({ input }: { input: unknown }) {
  if (!input || typeof input !== 'object') return null
  const entries = Object.entries(input as Record<string, unknown>)
  if (!entries.length) return null
  return (
    <dl className="mt-2 space-y-1.5 rounded-lg bg-hover p-3 text-[12.5px]">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="text-faint">{k}</dt>
          <dd className="whitespace-pre-wrap break-words">{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Tarjetas de aprobación: aparecen cuando Claude quiere hacer algo que requiere tu OK. */
export function ApprovalHost() {
  const [queue, setQueue] = useState<ApprovalRequest[]>([])
  useEvent<ApprovalRequest>('approval-request', (r) => setQueue((q) => [...q, r]))
  useEvent<string>('approval-closed', (id) => setQueue((q) => q.filter((r) => r.id !== id)))

  const answer = (id: string, ok: boolean) => {
    void call('approvals.answer', id, ok)
    setQueue((q) => q.filter((r) => r.id !== id))
  }

  if (!queue.length) return null
  const r = queue[0]
  return (
    <div className="fixed right-5 bottom-5 z-50 w-[420px] rounded-2xl border border-line-strong bg-raised p-4 shadow-2xl">
      <div className="flex items-center gap-2">
        <Icon name="sparkles" className="text-clay" />
        <span className="font-medium">Claude quiere hacer esto</span>
        <Pill tone="warning" className="ml-auto">
          Requiere OK
        </Pill>
      </div>
      <div className="mt-2 text-[13px]">
        <span className="font-medium">{r.serverName ?? 'claude'}</span> · {shortName(r.toolName)}
      </div>
      <div className="max-h-[40vh] overflow-y-auto">
        <ToolInput input={r.input} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        {queue.length > 1 ? <span className="text-[12px] text-faint">{queue.length - 1} más en cola</span> : null}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={() => answer(r.id, false)}>
            Rechazar
          </Button>
          <Button variant="primary" onClick={() => answer(r.id, true)}>
            <Icon name="check" /> Aprobar
          </Button>
        </div>
      </div>
    </div>
  )
}
