import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiStatus, PermissionRule } from '@shared/types'
import { MODE_LABEL } from '@shared/types'
import { parsePermissions } from '@shared/permissions'
import { call, useAction, useData } from '../api'
import { Markdown, slug } from '../components/Markdown'
import { Button, Card, ErrorNote, Icon, Pill } from '../components/ui'

interface Suggestion {
  section: string
  rule: string
  evidence: string
}

const MODE_TONE: Record<PermissionRule['mode'], 'success' | 'warning' | 'info' | 'danger'> = {
  auto: 'success',
  ask: 'warning',
  draft: 'info',
  deny: 'danger'
}

/** Id con el que se abre Mi flujo dentro de Notas. */
export const WORKFLOW_NOTE_ID = 'mi-flujo'

/** Mi flujo, mostrado como una página fija de Notas: se puede editar pero no borrar. */
export function Workflow({ ai }: { ai: AiStatus | null }) {
  const { data: wf, reload } = useData<{ markdown: string; version: number; updatedAt: string | null }>('workflow.get', [], ['workflow'])
  const { data: versions = [] } = useData<{ version: number; createdAt: string; preview: string }[]>('workflow.versions', [], ['workflow'])
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'edit' | 'view'>('view')
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const loaded = useRef<number | null>(null)

  useEffect(() => {
    if (wf && loaded.current !== wf.version) {
      loaded.current = wf.version
      setText(wf.markdown)
    }
  }, [wf])

  const dirty = wf ? text !== wf.markdown : false
  const save = useAction(async () => {
    await call('workflow.save', text)
    reload()
  })
  const suggest = useAction(async () => setSuggestions(await call<Suggestion[]>('workflow.suggest')))
  const exportSkill = useAction(() => call<string | null>('workflow.export'))
  const [exported, setExported] = useState<string | null>(null)

  const headings = useMemo(() => [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim()), [text])
  const rules = useMemo(() => parsePermissions(text), [text])

  const addSuggestion = async (s: Suggestion) => {
    if (dirty) await call('workflow.save', text)
    await call('workflow.appendRule', s.section, s.rule)
    setSuggestions((list) => list?.filter((x) => x !== s) ?? null)
    loaded.current = null
    reload()
  }

  return (
    <div className="mx-auto max-w-3xl px-10 pt-10 pb-24">
      <div>
        <div className="mb-4 flex items-center gap-2">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Mi flujo</h1>
            <p className="text-[13px] text-muted">
              Cómo trabajas, en tus palabras. Claude lo lee antes de cada brief y cada vez que actúa por ti. Esta página no se puede borrar.
            </p>
          </div>
          <div className="ml-auto flex shrink-0 gap-1.5">
            <div className="flex rounded-lg border border-line p-0.5">
              {(['view', 'edit'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-2.5 py-1 text-[12.5px] font-medium ${mode === m ? 'bg-selected' : 'text-muted hover:text-ink'}`}
                >
                  {m === 'view' ? 'Ver' : 'Editar'}
                </button>
              ))}
            </div>
            <Button variant="primary" disabled={!dirty} busy={save.busy} onClick={() => save.run()}>
              {dirty ? 'Guardar' : 'Guardado'}
            </Button>
          </div>
        </div>
        <ErrorNote>{save.error}</ErrorNote>

        <div className="py-2">
          {mode === 'edit' ? (
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void save.run()
                }
              }}
              spellCheck
              className="min-h-[65vh] w-full resize-none rounded-lg border border-line bg-transparent p-4 font-mono text-[13.5px] leading-relaxed outline-none"
            />
          ) : (
            <div onDoubleClick={() => setMode('edit')} title="Doble clic para editar">
              <Markdown text={text || '*Vacío.* Pulsa «Editar» para escribir tu flujo.'} />
            </div>
          )}
        </div>
        <p className="mt-2 text-[12px] text-faint">
          Versión {wf?.version ?? 0}
          {wf?.updatedAt ? ` · editado el ${new Date(wf.updatedAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}` : ''} · ⌘S para guardar
        </p>
      </div>

      <aside className="mt-10 grid grid-cols-1 gap-4 border-t border-line pt-6 md:grid-cols-2">
        {headings.length ? (
          <div>
            <div className="mb-1 text-[12px] font-medium text-muted">Secciones</div>
            {headings.map((h) => (
              <button
                key={h}
                onClick={() => {
                  setMode('view')
                  setTimeout(() => document.getElementById(slug(h))?.scrollIntoView({ behavior: 'smooth' }), 30)
                }}
                className="block w-full truncate rounded-md px-2 py-1 text-left text-[13px] text-muted hover:bg-hover hover:text-ink"
              >
                {h}
              </button>
            ))}
          </div>
        ) : null}

        <Card className="p-3">
          <div className="mb-2 text-[12.5px] font-medium">Permisos que entiende la app</div>
          {rules.length ? (
            <div className="space-y-1.5">
              {rules.map((r) => (
                <div key={r.pattern} className="flex items-center gap-2 text-[12.5px]">
                  <code className="flex-1 truncate">{r.pattern}</code>
                  <Pill tone={MODE_TONE[r.mode]}>{MODE_LABEL[r.mode]}</Pill>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-faint">Ninguno. Añade una sección «## Permisos» con líneas como «- slack: requiere OK».</p>
          )}
          <p className="mt-2 text-[11.5px] text-faint">Sin regla: leer es automático y escribir o enviar algo requiere tu OK.</p>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
            <Icon name="sparkles" className="text-clay" /> Sugerencias de Claude
          </div>
          <p className="mt-1 text-[12px] text-muted">Convierte en reglas lo que le has ido corrigiendo y los patrones de tus notas y encargos.</p>
          <Button size="sm" className="mt-2" busy={suggest.busy} disabled={ai?.ok === false} onClick={() => suggest.run()}>
            Proponer reglas
          </Button>
          <ErrorNote>{suggest.error}</ErrorNote>
          {suggestions?.length === 0 ? <p className="mt-2 text-[12px] text-faint">No he encontrado patrones nuevos.</p> : null}
          {suggestions?.map((s) => (
            <div key={s.rule} className="mt-3 rounded-lg border border-line p-2.5">
              <div className="text-[12px] text-faint">{s.section}</div>
              <div className="text-[13px]">«{s.rule}»</div>
              <div className="mt-1 text-[11.5px] text-muted">{s.evidence}</div>
              <div className="mt-2 flex gap-1.5">
                <Button size="sm" variant="primary" onClick={() => addSuggestion(s)}>
                  Añadir
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSuggestions((l) => l?.filter((x) => x !== s) ?? null)}>
                  Descartar
                </Button>
              </div>
            </div>
          ))}
        </Card>

        <Learned />

        <div className="space-y-1">
          <Button
            variant="ghost"
            className="w-full justify-start"
            busy={exportSkill.busy}
            onClick={async () => setExported((await exportSkill.run()) ?? null)}
          >
            <Icon name="download" /> Exportar como SKILL.md
          </Button>
          {exported ? <p className="px-3 text-[12px] text-success">Guardado en {exported}</p> : null}
          <Button variant="ghost" className="w-full justify-start" onClick={() => setShowHistory(!showHistory)}>
            <Icon name="history" /> Historial ({versions.length})
          </Button>
          {showHistory
            ? versions.map((v) => (
                <button
                  key={v.version}
                  className="block w-full rounded-md px-3 py-1.5 text-left text-[12px] text-muted hover:bg-hover"
                  onClick={async () => {
                    const md = await call<string | null>('workflow.version', v.version)
                    if (md !== null) {
                      setText(md)
                      setMode('view')
                    }
                  }}
                >
                  v{v.version} · {new Date(v.createdAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                </button>
              ))
            : null}
          {showHistory ? <p className="px-3 text-[11.5px] text-faint">Abre una versión y pulsa Guardar para restaurarla.</p> : null}
        </div>
      </aside>
    </div>
  )
}

/** Lo que Claude ha aprendido de tus correcciones: lo tiene en cuenta en cada respuesta. */
function Learned() {
  const { data: lessons = [] } = useData<{ at: string; where: string; text: string }[]>('learning.list', [], ['workflow', 'brief', 'news'])
  const [all, setAll] = useState(false)
  if (!lessons.length) return null
  const shown = all ? lessons : lessons.slice(0, 5)
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
        <Icon name="history" /> Lo que ha aprendido de ti ({lessons.length})
      </div>
      <p className="mt-1 text-[12px] text-muted">Tus correcciones recientes. Claude las tiene en cuenta siempre; quita las que no sean ciertas.</p>
      <ul className="mt-2 space-y-1.5">
        {shown.map((l) => (
          <li key={l.at} className="group flex items-start gap-1.5 text-[12px]">
            <span className="min-w-0 flex-1">
              <span className="text-faint">{l.where} · </span>
              {l.text}
            </span>
            <button className="shrink-0 text-faint opacity-0 group-hover:opacity-100 hover:text-ink" title="Olvidar" onClick={() => call('learning.forget', l.at)}>
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      {lessons.length > 5 ? (
        <button className="mt-1.5 text-[12px] text-muted hover:text-ink" onClick={() => setAll(!all)}>
          {all ? 'Ver menos' : `Ver las ${lessons.length}`}
        </button>
      ) : null}
    </Card>
  )
}
