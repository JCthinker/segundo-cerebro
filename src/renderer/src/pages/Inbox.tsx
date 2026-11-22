import { useState } from 'react'
import type { Area, Item } from '@shared/types'
import { KIND_LABEL } from '@shared/types'
import { call, useAction, useData } from '../api'
import { DuePill, SourceLine } from '../components/ItemRow'
import { Button, Card, Empty, ErrorNote, Icon, inputCls, PageHeader, Pill, SectionLabel, textareaCls } from '../components/ui'
import { useNav } from '../nav'

export function Inbox({ shortcut }: { shortcut: string | null }) {
  const { editItem } = useNav()
  const { data: items = [] } = useData<Item[]>('items.list', [{ status: ['proposed'] }], ['items'])
  const { data: areas = [] } = useData<Area[]>('areas.list', [], ['areas'])
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'capture' | 'transcript'>('capture')
  const [title, setTitle] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const analyze = useAction(async () => {
    if (!text.trim()) throw new Error('Escribe o pega algo primero.')
    const n = mode === 'capture' ? await call<number>('capture', text) : await call<number>('transcript', text, title)
    setMsg(n ? `${n} ${n === 1 ? 'elemento detectado' : 'elementos detectados'}. Revísalos abajo.` : 'No he encontrado promesas, entregas ni tareas en ese texto.')
    setText('')
    setTitle('')
  })
  const fromFile = useAction(async () => {
    const n = await call<number | null>('file.import')
    if (n !== null) setMsg(n ? `${n} elementos detectados en el archivo.` : 'No he encontrado nada accionable en el archivo.')
  })

  const confirm = (i: Item) => call('items.update', i.id, { status: 'active' })
  const dismiss = (i: Item) => call('items.update', i.id, { status: 'dismissed' })
  const confirmAll = async () => {
    for (const i of items) await confirm(i)
  }

  return (
    <div>
      <PageHeader
        title="Bandeja"
        subtitle="Todo lo que entra pasa por aquí. Nada cuenta hasta que lo confirmas."
        right={
          <Button variant="ghost" onClick={() => editItem(null)}>
            <Icon name="plus" /> Añadir a mano
          </Button>
        }
      />

      <Card className="p-4">
        <div className="mb-3 flex gap-1">
          {(
            [
              ['capture', 'Captura rápida'],
              ['transcript', 'Acta o transcripción']
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={`rounded-md px-2.5 py-1 text-[12.5px] font-medium ${mode === k ? 'bg-selected text-ink' : 'text-muted hover:bg-hover'}`}
            >
              {label}
            </button>
          ))}
          <button onClick={() => fromFile.run()} className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium text-muted hover:bg-hover">
            <Icon name="file" /> {fromFile.busy ? 'Analizando…' : 'Analizar un archivo'}
          </button>
        </div>
        {mode === 'transcript' ? (
          <input className={`${inputCls} mb-2`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título de la reunión" />
        ) : null}
        <textarea
          rows={mode === 'capture' ? 3 : 8}
          className={textareaCls}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void analyze.run()
          }}
          placeholder={
            mode === 'capture'
              ? 'Le prometí a Ana el informe para el jueves. Tengo que renovar el pasaporte antes de marzo…'
              : 'Pega aquí la transcripción o las notas de la reunión'
          }
        />
        <div className="mt-2 flex items-center gap-3">
          <span className="text-[12px] text-faint">
            ⌘ Enter para analizar{shortcut ? ` · Desde cualquier app: ${shortcut}` : ''}
          </span>
          <Button className="ml-auto" variant="claude" busy={analyze.busy} onClick={() => analyze.run()}>
            <Icon name="sparkles" /> Analizar
          </Button>
        </div>
        <ErrorNote>{analyze.error || fromFile.error}</ErrorNote>
        {msg ? <p className="mt-2 text-[13px] text-success">{msg}</p> : null}
      </Card>

      <SectionLabel
        right={
          items.length > 1 ? (
            <Button size="sm" variant="ghost" onClick={confirmAll}>
              Confirmar todo
            </Button>
          ) : null
        }
      >
        Detectado, pendiente de revisar ({items.length})
      </SectionLabel>
      {items.length ? (
        <Card className="px-4">
          {items.map((i) => (
            <div key={i.id} className="flex items-start gap-3 border-b border-line py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <button className="text-left font-medium hover:underline" onClick={() => editItem(i)}>
                  {i.title}
                </button>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Pill tone={i.kind === 'promise' ? 'clay' : 'neutral'}>
                    {KIND_LABEL[i.kind]}
                    {i.person ? ` · ${i.person}` : ''}
                  </Pill>
                  <DuePill item={i} />
                  {i.prepDays ? <Pill>{i.prepDays} días de preparación</Pill> : null}
                  {i.areaId ? <Pill>{areas.find((a) => a.id === i.areaId)?.name}</Pill> : null}
                </div>
                <SourceLine item={i} />
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => dismiss(i)}>
                  Descartar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => editItem(i)}>
                  Editar
                </Button>
                <Button size="sm" variant="primary" onClick={() => confirm(i)}>
                  <Icon name="check" /> Confirmar
                </Button>
              </div>
            </div>
          ))}
        </Card>
      ) : (
        <Empty title="La bandeja está vacía">
          Lo que Claude detecte en tus notas, capturas, archivos y herramientas aparecerá aquí para que lo confirmes.
        </Empty>
      )}
    </div>
  )
}
