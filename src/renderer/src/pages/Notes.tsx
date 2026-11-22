import { useEffect, useRef, useState } from 'react'
import type { AiStatus, Area, Item, Note } from '@shared/types'
import { KIND_LABEL } from '@shared/types'
import { call, useAction, useData } from '../api'
import { NoteEditor } from '../components/Editor'
import { DuePill } from '../components/ItemRow'
import { Button, Empty, ErrorNote, Icon, inputCls, Pill, Spinner } from '../components/ui'
import { useNav } from '../nav'

const EXTRACT_AFTER_MS = 4000

export function Notes({ ai }: { ai: AiStatus | null }) {
  const { param, go } = useNav()
  const { data: notes = [] } = useData<Note[]>('notes.list', [], ['notes'])
  const [q, setQ] = useState('')
  const { data: hits } = useData<{ id: string; title: string; snippet: string }[]>('notes.search', [q], [])
  const selected = param ?? notes[0]?.id ?? null

  const create = async () => {
    const n = await call<Note>('notes.create')
    go('notes', n.id)
  }

  const list = q.trim() ? (hits ?? []).map((h) => ({ id: h.id, title: h.title, sub: h.snippet })) : notes.map((n) => ({ id: n.id, title: n.title, sub: n.plain.slice(0, 80) }))

  return (
    <div className="-mx-8 -my-6 flex h-[calc(100vh)] min-h-0">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line">
        <div className="flex items-center gap-2 p-3 pt-6">
          <input className={inputCls} placeholder="Buscar en notas" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button size="sm" variant="ghost" onClick={create} title="Nueva nota" aria-label="Nueva nota">
            <Icon name="plus" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {list.map((n) => (
            <button
              key={n.id}
              onClick={() => go('notes', n.id)}
              className={`mb-0.5 block w-full rounded-lg px-2.5 py-2 text-left ${n.id === selected ? 'bg-selected' : 'hover:bg-hover'}`}
            >
              <div className="truncate text-[13px] font-medium">{n.title || 'Sin título'}</div>
              <div className="truncate text-[12px] text-faint">{n.sub || ' '}</div>
            </button>
          ))}
          {!list.length ? <p className="px-2 py-4 text-[12.5px] text-faint">{q ? 'Sin resultados' : 'Aún no hay notas'}</p> : null}
        </div>
      </aside>
      <section className="min-w-0 flex-1 overflow-y-auto">
        {selected ? (
          <NoteView key={selected} id={selected} ai={ai} />
        ) : (
          <div className="p-10">
            <Empty title="Escribe tu primera nota" action={<Button variant="primary" onClick={create}>Nueva nota</Button>}>
              Mientras escribes, Claude detecta promesas, entregas y tareas y las deja en la bandeja.
            </Empty>
          </div>
        )}
      </section>
    </div>
  )
}

function NoteView({ id, ai }: { id: string; ai: AiStatus | null }) {
  const { go, editItem } = useNav()
  const [note, setNote] = useState<Note | null>(null)
  const [title, setTitle] = useState('')
  const [saved, setSaved] = useState(true)
  const draft = useRef<{ json: string; plain: string } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const extractTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const { data: allItems = [] } = useData<Item[]>('items.list', [{}], ['items'])
  const { data: areas = [] } = useData<Area[]>('areas.list', [], ['areas'])
  const detected = allItems.filter((i) => i.sourceRef === id && i.status !== 'dismissed')

  const extract = useAction((force: boolean) => call<number>('notes.extract', id, force))

  useEffect(() => {
    void call<Note>('notes.get', id).then((n) => {
      setNote(n)
      setTitle(n?.title ?? '')
    })
    return () => {
      clearTimeout(saveTimer.current)
      clearTimeout(extractTimer.current)
      void flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Refs para que el guardado al salir de la nota vea siempre lo último escrito.
  const titleRef = useRef(title)
  titleRef.current = title
  const noteRef = useRef(note)
  noteRef.current = note
  const dirty = useRef(false)

  const flush = async () => {
    if (!dirty.current) return
    dirty.current = false
    const d = draft.current ?? { json: noteRef.current?.contentJson ?? '', plain: noteRef.current?.plain ?? '' }
    await call('notes.save', id, titleRef.current, d.json, d.plain)
    setSaved(true)
  }

  const schedule = () => {
    dirty.current = true
    setSaved(false)
    clearTimeout(saveTimer.current)
    clearTimeout(extractTimer.current)
    saveTimer.current = setTimeout(() => {
      void flush().then(() => {
        if (ai?.ok) extractTimer.current = setTimeout(() => void extract.run(false), EXTRACT_AFTER_MS)
      })
    }, 700)
  }

  if (!note) return null

  return (
    <div className="mx-auto max-w-3xl px-10 pt-10 pb-24">
      <div className="mb-2 flex items-center gap-2 text-[12px] text-faint">
        <span>{saved ? 'Guardado' : 'Guardando…'}</span>
        {extract.busy ? (
          <span className="flex items-center gap-1.5">
            · <Spinner className="h-3 w-3" /> Claude está leyendo la nota
          </span>
        ) : null}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" busy={extract.busy} onClick={() => flush().then(() => extract.run(true))}>
            <Icon name="sparkles" className="text-clay" /> Analizar ahora
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await call('notes.delete', id)
              go('notes')
            }}
            aria-label="Eliminar nota"
          >
            <Icon name="trash" />
          </Button>
        </div>
      </div>
      <input
        className="mb-4 w-full bg-transparent text-[28px] font-semibold tracking-tight outline-none placeholder:text-faint"
        placeholder="Sin título"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value)
          schedule()
        }}
      />
      <NoteEditor
        noteId={id}
        contentJson={note.contentJson}
        onChange={(json, plain) => {
          draft.current = { json, plain }
          schedule()
        }}
      />
      <ErrorNote>{extract.error}</ErrorNote>

      <div className="mt-10 border-t border-line pt-4">
        <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-muted">
          <Icon name="sparkles" className="text-clay" /> Detectado en esta nota
          {!ai?.ok ? <span className="font-normal text-faint">· conecta Claude en Ajustes para que se detecte solo</span> : null}
        </div>
        {detected.length ? (
          detected.map((i) => (
            <div key={i.id} className="flex items-center gap-2 border-b border-line py-2 last:border-0">
              <button className={`flex-1 text-left text-[13px] hover:underline ${i.status === 'done' ? 'text-faint line-through' : ''}`} onClick={() => editItem(i)}>
                {i.title}
              </button>
              <Pill>{KIND_LABEL[i.kind]}{i.person ? ` · ${i.person}` : ''}</Pill>
              {i.areaId ? <Pill>{areas.find((a) => a.id === i.areaId)?.name}</Pill> : null}
              <DuePill item={i} />
              {i.status === 'proposed' ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => call('items.update', i.id, { status: 'dismissed' })}>
                    Descartar
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => call('items.update', i.id, { status: 'active' })}>
                    Confirmar
                  </Button>
                </>
              ) : (
                <Pill tone={i.status === 'done' ? 'success' : 'info'}>{i.status === 'done' ? 'Hecho' : 'Activo'}</Pill>
              )}
            </div>
          ))
        ) : (
          <p className="text-[12.5px] text-faint">Nada todavía.</p>
        )}
      </div>
    </div>
  )
}
