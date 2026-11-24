import { useEffect, useState } from 'react'
import { call, useAction } from '../api'
import { useNav } from '../nav'
import { Button, ErrorNote, Icon, Modal, Spinner } from './ui'

type Tag = 'DECISION' | 'TAREA_FP' | 'PREGUNTA' | 'PARTICIPA' | 'ENCARGO'
interface Entry {
  tag: Tag
  text: string
  roadKey: string | null
  person: string | null
}

const TAGS: { tag: Tag; label: string; where: string }[] = [
  { tag: 'DECISION', label: 'Decisiones', where: 'Conclusión en Jira ROAD' },
  { tag: 'TAREA_FP', label: 'Tareas FP', where: 'Crear en Jira FP' },
  { tag: 'PARTICIPA', label: 'Participan', where: 'Desarrollador en la iniciativa' },
  { tag: 'PREGUNTA', label: 'Preguntas abiertas', where: 'Comentario en ROAD' },
  { tag: 'ENCARGO', label: 'Encargos', where: 'A tu lista de Encargos' }
]

/**
 * «Revisar y repartir»: Claude lee la nota de la reunión y separa lo que va a Jira (ROAD y FP)
 * de lo que son encargos para ti. Tú eliges; lo de Jira lo hace Claude pidiéndote OK.
 */
export function ReviewNote({ noteId, title, onClose }: { noteId: string; title: string; onClose: () => void }) {
  const { talk } = useNav()
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [off, setOff] = useState<Set<number>>(new Set())
  const review = useAction(async () => setEntries(await call<Entry[]>('notes.review', noteId)))
  useEffect(() => {
    void review.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId])

  const send = useAction(async () => {
    if (!entries) return
    const chosen = entries.filter((_, i) => !off.has(i))
    const skipped = entries.filter((_, i) => off.has(i))
    await call('notes.distribute', noteId, chosen, skipped)
    const jira = chosen.filter((e) => e.tag !== 'ENCARGO')
    if (jira.length) {
      const lines = jira.map((e) => `- [${TAGS.find((t) => t.tag === e.tag)!.where}]${e.roadKey ? ` ${e.roadKey}` : ''}: ${e.text}${e.person ? ` (${e.person})` : ''}`)
      talk(
        `Registra en Jira lo que salió de la reunión «${title}»:\n${lines.join('\n')}\nLas decisiones y preguntas van como comentario en su iniciativa de ROAD; las tareas FP, creadas en FP y enlazadas a su iniciativa; quien participa, como desarrollador de la iniciativa. Enséñame qué vas a escribir y pídeme OK antes.`
      )
    }
    onClose()
  })

  const toggle = (i: number) => {
    const n = new Set(off)
    if (n.has(i)) n.delete(i)
    else n.add(i)
    setOff(n)
  }

  return (
    <Modal onClose={onClose} width="max-w-2xl">
      <div className="border-b border-line px-5 py-4">
        <div className="text-[15px] font-semibold">Revisar y repartir</div>
        <p className="mt-0.5 text-[12.5px] text-muted">Lo que Claude ha encontrado en «{title || 'esta nota'}». Quita lo que no quieras repartir.</p>
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
        {review.busy ? (
          <div className="flex items-center gap-2 py-6 text-[13px] text-muted">
            <Spinner /> Claude está leyendo la nota…
          </div>
        ) : null}
        <ErrorNote>{review.error}</ErrorNote>
        {entries && !entries.length ? <p className="py-6 text-center text-[13px] text-muted">No he encontrado nada que repartir en esta nota.</p> : null}
        {entries
          ? TAGS.map(({ tag, label, where }) => {
              const rows = entries.map((e, i) => [e, i] as const).filter(([e]) => e.tag === tag)
              if (!rows.length) return null
              return (
                <div key={tag} className="mb-3">
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-[12px] font-semibold tracking-wide uppercase">{label}</span>
                    <span className="text-[11.5px] text-faint">→ {where}</span>
                  </div>
                  {rows.map(([e, i]) => (
                    <label key={i} className="flex cursor-pointer items-start gap-2 py-1 text-[13px]">
                      <input type="checkbox" className="mt-1" checked={!off.has(i)} onChange={() => toggle(i)} />
                      <span className={off.has(i) ? 'text-faint line-through' : ''}>
                        {e.roadKey ? <span className="mr-1.5 text-[12px] text-faint">{e.roadKey}</span> : null}
                        {e.text}
                        {e.person ? <span className="text-clay"> · {e.person}</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              )
            })
          : null}
      </div>
      <ErrorNote>{send.error}</ErrorNote>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" busy={send.busy} disabled={!entries?.length || entries.length === off.size} onClick={() => send.run()}>
          <Icon name="check" /> Repartir
        </Button>
      </div>
    </Modal>
  )
}
