import { useEffect, useRef, useState } from 'react'
import type { AiStatus } from '@shared/types'
import { call } from '../api'
import { Button, ErrorNote, Icon, PageHeader, Spinner } from '../components/ui'

interface Msg {
  role: 'user' | 'assistant'
  text: string
}

const EXAMPLES = ['¿Qué le debo a Marta?', '¿Qué decidimos sobre la campaña de enero?', '¿Qué tengo que preparar para mañana?', '¿Qué promesas se me están acumulando?']

export function Ask({ ai }: { ai: AiStatus | null }) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [msgs, busy])

  const send = async (q = text) => {
    if (!q.trim() || busy) return
    const next = [...msgs, { role: 'user' as const, text: q.trim() }]
    setMsgs(next)
    setText('')
    setBusy(true)
    setError(null)
    try {
      const answer = await call<string>('ask', next)
      setMsgs([...next, { role: 'assistant', text: answer }])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-3xl flex-col">
      <PageHeader
        title="Preguntar"
        subtitle="Pregúntale a tu segundo cerebro. Busca en tus notas, compromisos, agenda y herramientas conectadas."
        right={msgs.length ? <Button variant="ghost" onClick={() => setMsgs([])}>Nueva conversación</Button> : null}
      />
      <div className="flex-1 space-y-5">
        {!msgs.length ? (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <Button key={e} variant="secondary" onClick={() => send(e)} disabled={ai?.ok === false}>
                {e}
              </Button>
            ))}
          </div>
        ) : null}
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ml-auto w-fit max-w-[80%] rounded-2xl bg-selected px-4 py-2 text-[14px] whitespace-pre-wrap">
              {m.text}
            </div>
          ) : (
            <div key={i} className="font-voice text-[15.5px] leading-relaxed whitespace-pre-wrap">
              {m.text}
            </div>
          )
        )}
        {busy ? (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Spinner /> Buscando…
          </div>
        ) : null}
        <ErrorNote>{error}</ErrorNote>
        <div ref={end} />
      </div>
      <div className="sticky bottom-0 bg-page pt-3 pb-6">
        <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-raised p-2">
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={ai?.ok === false ? 'Conecta Claude en Ajustes para preguntar' : 'Pregunta lo que quieras'}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] outline-none"
          />
          <Button variant="claude" onClick={() => send()} busy={busy} disabled={!text.trim()} aria-label="Enviar">
            <Icon name="arrow" />
          </Button>
        </div>
      </div>
    </div>
  )
}
