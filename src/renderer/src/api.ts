import { useCallback, useEffect, useRef, useState } from 'react'

interface Bridge {
  call(method: string, ...args: unknown[]): Promise<unknown>
  on(event: string, cb: (payload: unknown) => void): () => void
  closeCapture(): void
}

declare global {
  interface Window {
    cerebro: Bridge
  }
}

export const bridge = window.cerebro

export function call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  return bridge.call(method, ...args) as Promise<T>
}

export function useEvent<T>(event: string, cb: (payload: T) => void): void {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => bridge.on(event, (p) => ref.current(p as T)), [event])
}

/** Carga datos y los recarga cuando el proceso principal avisa de cambios. */
export function useData<T>(method: string, args: unknown[] = [], watch: string[] = ['all']): {
  data: T | undefined
  error: string | null
  reload: () => void
} {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const key = JSON.stringify(args)
  const reload = useCallback(() => {
    call<T>(method, ...(JSON.parse(key) as unknown[]))
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [method, key])
  useEffect(reload, [reload])
  useEvent<string>('data-changed', (what) => {
    if (what === 'all' || watch.includes(what) || watch.includes('all')) reload()
  })
  return { data, error, reload }
}

/** Ejecuta una acción asíncrona con estado de carga y error. */
export function useAction<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(
    async (...a: A): Promise<R | undefined> => {
      setBusy(true)
      setError(null)
      try {
        return await fn(...a)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [fn]
  )
  return { run, busy, error, setError }
}
