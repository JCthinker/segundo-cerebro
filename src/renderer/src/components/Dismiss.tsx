import { useState } from 'react'
import type { Item } from '@shared/types'
import { call } from '../api'
import { Button, Icon, inputCls } from './ui'

const QUICK = ['No me toca a mí', 'Ya está hecho', 'No es importante', 'Está repetida', 'No encaja en mi flujo']

/**
 * Botón de descartar que pregunta (sin obligar) por qué. Claude usa esos motivos
 * para no volver a proponerte cosas parecidas.
 */
export function DismissButton({ item, label }: { item: Item; label?: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const dismiss = (why: string) => {
    setOpen(false)
    void call('items.update', item.id, { status: 'dismissed', dismissReason: why.trim() || null })
  }
  return (
    <div className="relative">
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} title="Descartar">
        {label ?? <Icon name="x" />}
      </Button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-line bg-raised p-3 shadow-lg">
          <div className="mb-2 text-[12.5px] font-medium">¿Por qué lo descartas?</div>
          <div className="mb-2 flex flex-wrap gap-1">
            {QUICK.map((q) => (
              <button key={q} onClick={() => dismiss(q)} className="rounded-full bg-hover px-2 py-0.5 text-[12px] text-muted hover:bg-selected hover:text-ink">
                {q}
              </button>
            ))}
          </div>
          <input
            autoFocus
            className={inputCls}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') dismiss(reason)
              if (e.key === 'Escape') setOpen(false)
            }}
            placeholder="Otro motivo (opcional)"
          />
          <p className="mt-1.5 text-[11.5px] text-faint">Claude aprende de esto para no proponerte cosas parecidas.</p>
          <div className="mt-2 flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => dismiss('')}>
              Sin motivo
            </Button>
            <Button size="sm" variant="primary" disabled={!reason.trim()} onClick={() => dismiss(reason)}>
              Descartar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
