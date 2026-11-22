import { useMemo, useState } from 'react'
import type { Area, Item, ItemKind, ItemStatus } from '@shared/types'
import { scoreItem } from '@shared/priority'
import { useData } from '../api'
import { ItemRow } from '../components/ItemRow'
import { Button, Card, Empty, Icon, inputBase, PageHeader } from '../components/ui'
import { useNav } from '../nav'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function Commitments({ kind }: { kind: ItemKind }) {
  const { editItem } = useNav()
  const [status, setStatus] = useState<ItemStatus | 'open'>('open')
  const [person, setPerson] = useState('')
  const [areaId, setAreaId] = useState('')
  const { data: items = [] } = useData<Item[]>('items.list', [{ kind: [kind] }], ['items'])
  const { data: areas = [] } = useData<Area[]>('areas.list', [], ['areas'])

  const people = useMemo(() => [...new Set(items.map((i) => i.person).filter(Boolean) as string[])].sort(), [items])
  const t = today()
  const rows = items
    .filter((i) => (status === 'open' ? i.status === 'active' : i.status === status))
    .filter((i) => !person || i.person === person)
    .filter((i) => !areaId || i.areaId === areaId)
    .map((i) => scoreItem(i, t, areas))
    .sort((a, b) => (status === 'open' ? b.score - a.score : (b.item.updatedAt > a.item.updatedAt ? 1 : -1)))

  const isPromise = kind === 'promise'
  return (
    <div>
      <PageHeader
        title={isPromise ? 'Promesas' : 'Entregas'}
        subtitle={isPromise ? 'Lo que le has dicho a otras personas que harías.' : 'Fechas límite, con el tiempo que necesitas para prepararlas.'}
        right={
          <Button variant="primary" onClick={() => editItem(null, { kind })}>
            <Icon name="plus" /> {isPromise ? 'Nueva promesa' : 'Nueva entrega'}
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <select className={inputBase} value={status} onChange={(e) => setStatus(e.target.value as ItemStatus | 'open')}>
          <option value="open">Pendientes</option>
          <option value="done">Hechas</option>
          <option value="renegotiated">Renegociadas</option>
          <option value="dismissed">Descartadas</option>
        </select>
        {people.length ? (
          <select className={inputBase} value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Todas las personas</option>
            {people.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        ) : null}
        <select className={inputBase} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          <option value="">Todas las áreas</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      {rows.length ? (
        <Card className="px-4">
          {rows.map((s) => (
            <ItemRow key={s.item.id} scored={status === 'open' ? s : undefined} item={s.item} areas={areas} />
          ))}
        </Card>
      ) : (
        <Empty title={isPromise ? 'No hay promesas aquí' : 'No hay entregas aquí'}>
          {status === 'open' ? 'Las que detecte Claude en tus notas aparecerán primero en la bandeja.' : null}
        </Empty>
      )}
    </div>
  )
}
