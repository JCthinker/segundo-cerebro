import { useEffect, useRef, useState } from 'react'
import { addDays, toDay } from '@shared/dates'
import { noteWhen, type ItemNote } from '@shared/item-notes'
import type { Area, Item, ItemKind, ItemStatus } from '@shared/types'
import { call, useAction, useData } from '../api'
import { useNav } from '../nav'
import { SourceLine } from './ItemRow'
import { Button, ErrorNote, Field, Icon, inputCls, Modal, textareaCls } from './ui'

const STATUS_LABEL: Record<ItemStatus, string> = {
  proposed: 'Por confirmar',
  active: 'Activo',
  done: 'Hecho',
  dismissed: 'Descartado',
  renegotiated: 'Renegociado'
}

/** Cuadro de texto que crece con lo que escribes, para poder leerlo entero. */
function GrowingText({ value, onChange, placeholder, minRows = 4, autoFocus, onKeyDown }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  minRows?: number
  autoFocus?: boolean
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, window.innerHeight * 0.5)}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={minRows}
      autoFocus={autoFocus}
      className={`${textareaCls} resize-y text-[13.5px] leading-relaxed`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
    />
  )
}

export function ItemEditor({ item, defaults, onClose }: { item: Item | null; defaults?: Partial<Item>; onClose: () => void }) {
  const { resolve } = useNav()
  const { data: areas = [] } = useData<Area[]>('areas.list', [], ['areas'])
  const [f, setF] = useState<Partial<Item>>(
    item ?? { kind: 'task', title: '', person: null, dueDate: addDays(toDay(new Date()), 1), prepDays: 0, areaId: null, status: 'active', ...defaults }
  )
  const set = <K extends keyof Item>(k: K, v: Item[K]) => setF((p) => ({ ...p, [k]: v }))
  const save = useAction(async () => {
    if (!f.title?.trim()) throw new Error('Escribe un título.')
    if (item) await call('items.update', item.id, f)
    else await call('items.create', { ...f, sourceType: 'manual' })
    onClose()
  })
  const remove = async () => {
    if (item && !window.confirm(`¿Eliminar «${item.title}»? No se puede deshacer.`)) return
    if (item) await call('items.delete', item.id)
    onClose()
  }

  return (
    <Modal onClose={onClose} width="max-w-4xl">
      <div className="p-6">
        <div className="mb-4 flex items-center">
          <h2 className="text-[16px] font-semibold">{item ? 'Detalle' : 'Nuevo elemento'}</h2>
          <button className="ml-auto text-muted hover:text-ink" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </div>
        <div className="grid grid-cols-[1fr_15rem] gap-6">
          {/* Izquierda: lo que hay que leer */}
          <div className="min-w-0 space-y-4">
            <Field label="Qué">
              <input
                autoFocus={!item}
                className={`${inputCls} h-9 text-[14.5px] font-medium`}
                value={f.title ?? ''}
                onChange={(e) => set('title', e.target.value)}
                placeholder="Enviar el informe trimestral a Ana"
              />
            </Field>
            <Field label="Contexto" hint="Qué ha pasado y qué hay que hacer">
              <GrowingText
                value={f.context ?? ''}
                onChange={(v) => set('context', v || null)}
                placeholder="Ana lo pidió en la reunión del lunes; hay que mandárselo por correo."
              />
            </Field>
            {item && (item.sourceSnippet || item.sourceRef) ? (
              <div>
                <div className="mb-1 text-[12.5px] font-medium text-muted">De dónde sale</div>
                <div className="rounded-lg bg-panel px-3 py-2 text-[13px]">
                  <SourceLine item={item} full />
                </div>
              </div>
            ) : null}
            {item?.status === 'dismissed' && item.dismissReason ? (
              <div className="text-[12px] text-faint">Descartado: «{item.dismissReason}»</div>
            ) : null}
            {item ? <ItemNotes itemId={item.id} /> : null}
          </div>

          {/* Derecha: los datos */}
          <div className="space-y-3">
            <Field label="Tipo">
              <select className={inputCls} value={f.kind} onChange={(e) => set('kind', e.target.value as ItemKind)}>
                <option value="promise">Promesa a alguien</option>
                <option value="deadline">Entrega</option>
                <option value="task">Tarea</option>
                <option value="decision">Decisión</option>
              </select>
            </Field>
            <Field label="Persona" hint={f.kind === 'promise' ? 'Quién te lo pidió' : undefined}>
              <input className={inputCls} value={f.person ?? ''} onChange={(e) => set('person', e.target.value || null)} placeholder="Ana" />
            </Field>
            <Field label="Fecha límite">
              <input type="date" className={inputCls} value={f.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value || null)} />
            </Field>
            <Field label="Días de preparación" hint="Cuántos días necesitas antes de la fecha">
              <input type="number" min={0} className={inputCls} value={f.prepDays ?? 0} onChange={(e) => set('prepDays', Math.max(0, Number(e.target.value) || 0))} />
            </Field>
            <Field label="Área">
              <select className={inputCls} value={f.areaId ?? ''} onChange={(e) => set('areaId', e.target.value || null)}>
                <option value="">Sin área</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Estado">
              <select className={inputCls} value={f.status} onChange={(e) => set('status', e.target.value as ItemStatus)}>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        <ErrorNote>{save.error}</ErrorNote>
        <div className="mt-6 flex items-center gap-2 border-t border-line pt-4">
          {item ? (
            <>
              <Button variant="danger" onClick={remove}>
                <Icon name="trash" /> Eliminar
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  onClose()
                  resolve(item)
                }}
              >
                <Icon name="sparkles" className="text-clay" /> Resolver con Claude
              </Button>
            </>
          ) : null}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" busy={save.busy} onClick={() => save.run()}>
              Guardar
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Notas y comentarios de una tarea: se guardan al momento, con su fecha. */
function ItemNotes({ itemId }: { itemId: string }) {
  const { data: notes = [], reload } = useData<ItemNote[]>('items.notes', [itemId], ['items'])
  const [text, setText] = useState('')
  const add = useAction(async () => {
    if (!text.trim()) return
    await call('items.addNote', itemId, text)
    setText('')
    reload()
  })
  const del = async (n: ItemNote) => {
    if (!window.confirm('¿Borrar esta nota?')) return
    await call('items.deleteNote', n.id)
    reload()
  }
  return (
    <div>
      <div className="mb-1 text-[12.5px] font-medium text-muted">Notas{notes.length ? ` (${notes.length})` : ''}</div>
      {notes.length ? (
        <div className="mb-2 space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="group rounded-lg border border-line px-3 py-2">
              <div className="flex items-center text-[11.5px] text-faint">
                {noteWhen(n.createdAt)}
                <button className="ml-auto opacity-0 hover:text-ink group-hover:opacity-100" onClick={() => void del(n)} title="Borrar nota">
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">{n.text}</div>
            </div>
          ))}
        </div>
      ) : null}
      <GrowingText
        minRows={2}
        value={text}
        onChange={setText}
        placeholder="Añade una nota: qué has hecho, con quién has hablado, qué falta…"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void add.run()
          }
        }}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-[11.5px] text-faint">Se guarda al momento · ⌘↵ para añadir</span>
        <Button size="sm" className="ml-auto" disabled={!text.trim()} busy={add.busy} onClick={() => void add.run()}>
          <Icon name="plus" /> Añadir nota
        </Button>
      </div>
      <ErrorNote>{add.error}</ErrorNote>
    </div>
  )
}
