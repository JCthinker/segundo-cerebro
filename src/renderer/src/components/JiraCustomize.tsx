import { useState } from 'react'
import { ROAD_STAGES, unknownStatuses, type JiraPrefs, type JiraSnapshot, type StageId } from '@shared/jira'
import { call, useAction } from '../api'
import { Button, ErrorNote, Field, Icon, inputCls, Modal } from './ui'

interface Guess {
  road: string | null
  fp: string | null
  statuses: { status: string; stage: string }[]
  note: string
}

/** Personalizar cómo se ve Jira. Claude puede deducirlo mirando tu Jira. */
export function JiraCustomize({ prefs, snap, onClose }: { prefs: JiraPrefs; snap: JiraSnapshot | null; onClose: () => void }) {
  const [p, setP] = useState<JiraPrefs>(prefs)
  const [note, setNote] = useState<string | null>(null)
  const [extra, setExtra] = useState<string[]>([])
  const unknown = [...new Set([...unknownStatuses(snap), ...Object.keys(p.aliases), ...extra])]

  const guess = useAction(async () => {
    const g = await call<Guess>('jira.guess')
    const aliases = { ...p.aliases }
    const found: string[] = []
    for (const s of g.statuses) {
      const isStage = ROAD_STAGES.some((r) => r.label.toLowerCase() === s.status.trim().toLowerCase())
      if (!isStage && s.stage !== 'other') {
        aliases[s.status] = s.stage as StageId
        found.push(s.status)
      }
    }
    setExtra(found)
    setP({ ...p, road: g.road ?? p.road, fp: g.fp ?? p.fp, aliases })
    setNote(g.note)
  })
  const save = useAction(async () => {
    await call('jira.savePrefs', p)
    onClose()
  })
  const toggle = (id: StageId) => setP({ ...p, hidden: p.hidden.includes(id) ? p.hidden.filter((x) => x !== id) : [...p.hidden, id] })

  return (
    <Modal onClose={onClose} width="max-w-2xl">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="flex-1">
          <div className="text-[15px] font-semibold">Personalizar Jira</div>
          <p className="mt-0.5 text-[12.5px] text-muted">Qué proyectos leer, qué ver en el tablero y cómo se llaman tus estados.</p>
        </div>
        <Button size="sm" variant="claude" busy={guess.busy} onClick={() => void guess.run()}>
          <Icon name="sparkles" /> Que Claude lo deduzca
        </Button>
      </div>
      <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
        <ErrorNote>{guess.error}</ErrorNote>
        {note ? <p className="rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-[13px]">{note}</p> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Proyecto de iniciativas">
            <input className={inputCls} value={p.road} onChange={(e) => setP({ ...p, road: e.target.value })} />
          </Field>
          <Field label="Proyecto de tareas y épicas">
            <input className={inputCls} value={p.fp} onChange={(e) => setP({ ...p, fp: e.target.value })} />
          </Field>
        </div>
        <Field label="Leer solo lo que cumpla (opcional)" hint="Una condición de Jira, por ejemplo «team = Pagos» o «labels = growth». Vacío: todo el proyecto.">
          <input className={inputCls} value={p.filter} onChange={(e) => setP({ ...p, filter: e.target.value })} placeholder="team = Pagos" />
        </Field>
        <div>
          <div className="mb-1.5 text-[12.5px] font-medium text-muted">Columnas del tablero</div>
          <div className="flex flex-wrap gap-1.5">
            {ROAD_STAGES.map((s) => (
              <button
                key={s.id}
                onClick={() => toggle(s.id)}
                className={`h-7 rounded-lg border px-2.5 text-[12.5px] ${p.hidden.includes(s.id) ? 'border-line text-faint line-through' : 'border-ink bg-ink text-page'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {unknown.length ? (
          <div>
            <div className="mb-1.5 text-[12.5px] font-medium text-muted">Estados con otro nombre</div>
            <div className="space-y-1.5">
              {unknown.map((st) => (
                <div key={st} className="flex items-center gap-2 text-[13px]">
                  <span className="flex-1">«{st}» es…</span>
                  <select
                    className={`${inputCls} w-48`}
                    value={p.aliases[st] ?? ''}
                    onChange={(e) => {
                      const aliases = { ...p.aliases }
                      if (e.target.value) aliases[st] = e.target.value as StageId
                      else delete aliases[st]
                      setP({ ...p, aliases })
                    }}
                  >
                    <option value="">Ninguno (columna «Otro estado»)</option>
                    {ROAD_STAGES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <span className="mr-auto text-[12px] text-faint">Si cambias proyectos o filtro, Claude vuelve a leer Jira.</span>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" busy={save.busy} onClick={() => void save.run()}>
          Guardar
        </Button>
      </div>
    </Modal>
  )
}
