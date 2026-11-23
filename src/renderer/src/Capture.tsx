import { useEffect, useRef, useState } from 'react'
import { bridge, call } from './api'
import { Icon, Spinner } from './components/ui'

/** Ventana flotante de captura rápida (atajo global). */
export function Capture() {
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const focus = () => ref.current?.focus()
    window.addEventListener('focus', focus)
    focus()
    return () => window.removeEventListener('focus', focus)
  }, [])

  const close = () => {
    setText('')
    setState('idle')
    bridge.closeCapture()
  }

  const send = async () => {
    if (!text.trim()) return
    setState('busy')
    try {
      const n = await call<number>('capture', text)
      setMsg(n ? `${n} ${n === 1 ? 'cosa apuntada' : 'cosas apuntadas'} en tu dashboard` : 'Guardado: no había nada que detectar')
      setState('done')
      setTimeout(close, 1200)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-line-strong bg-raised/95 p-4">
      <div className="mb-2 flex items-center gap-2 text-[12px] text-muted">
        <Icon name="bolt" className="text-clay" /> Captura rápida
        <span className="ml-auto text-faint">Enter para guardar · Esc para cerrar</span>
      </div>
      <textarea
        ref={ref}
        autoFocus
        value={text}
        disabled={state === 'busy'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void send()
          }
        }}
        placeholder="Le prometí a Ana el informe para el jueves…"
        className="flex-1 resize-none bg-transparent text-[16px] outline-none placeholder:text-faint"
      />
      <div className="h-5 text-[12.5px]">
        {state === 'busy' ? (
          <span className="flex items-center gap-2 text-muted">
            <Spinner /> Claude lo está leyendo…
          </span>
        ) : state === 'done' ? (
          <span className="text-success">{msg}</span>
        ) : state === 'error' ? (
          <span className="text-danger">{msg}</span>
        ) : null}
      </div>
    </div>
  )
}
