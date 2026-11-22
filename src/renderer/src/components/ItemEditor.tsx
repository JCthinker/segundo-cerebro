import { useState } from 'react'
import type { Area, Item, ItemKind, ItemStatus } from '@shared/types'
import { call, useAction, useData } from '../api'
import { useNav } from '../nav'
import { SourceLine } from './ItemRow'
import { Button, ErrorNote, Field, Icon, inputCls, Modal } from './ui'

const STATUS_LABEL: Record<ItemStatus, string> = {
  proposed: 'Por confirmar',
  active: 'Activo',
  done: 'Hecho',
  dismissed: 'Descartado',
  renegotiated: 'Renegociado'
}

export function ItemEditor({ item, defaults, onClose }: { item: Item | null; defaults?: Partial<Item>; onClose: () => void }) {
  const { resolve } = useNav()
  const { data: areas = [] } = useData<Area[]>('areas.list', [], ['areas'])
  const [f, setF] = useState<Partial<Item>>(
    item ?? { kind: 'task', title: '', person: null, dueDate: null, prepDays: 0, areaId: null, status: 'active', ...defaults }
  )
  const set = <K extends keyof Item>(k: K, v: Item[K]) => setF((p) => ({ ...p, [k]: v }))
  const save = useAction(async () => {
    if (!f.title?.trim()) throw new Error('Escribe un título.')
    if (item) await call('items.update', item.id, f)
    else await call('items.create', { ...f, sourceType: 'manual' })
    onClose()
  })
  const remove = async () => {
    if (item) await call('items.delete', item.id)
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <div className="p-5">
        <div className="mb-4 flex items-center">
          <h2 className="text-[16px] font-semibold">{item ? 'Editar' : 'Nuevo elemento'}</h2>
          <button className="ml-auto text-muted hover:text-ink" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Qué">
              <input autoFocus className={inputCls} value={f.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="Enviar el informe trimestral a Ana" />
            </Field>
          </div>
          <Field label="Tipo">
            <select className={inputCls} value={f.kind} onChange={(e) => set('kind', e.target.value as ItemKind)}>
              <option value="promise">Promesa a alguien</option>
              <option value="deadline">Entrega</option>
              <option value="task">Tarea</option>
              <option value="decision">Decisión</option>
            </select>
          </Field>
          <Field label="Persona" hint={f.kind === 'promise' ? 'A quién se lo prometiste' : undefined}>
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
        {item ? (
          <div className="mt-3">
            <SourceLine item={item} />
          </div>
        ) : null}
        <ErrorNote>{save.error}</ErrorNote>
        <div className="mt-5 flex items-center gap-2">
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
