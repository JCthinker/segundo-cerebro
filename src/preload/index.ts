import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

type Result = { ok: true; data: unknown } | { ok: false; error: string }

contextBridge.exposeInMainWorld('cerebro', {
  async call(method: string, ...args: unknown[]): Promise<unknown> {
    const r = (await ipcRenderer.invoke('api', method, ...args)) as Result
    if (!r.ok) throw new Error(r.error)
    return r.data
  },
  on(event: string, cb: (payload: unknown) => void): () => void {
    const listener = (_e: IpcRendererEvent, name: string, payload: unknown) => {
      if (name === event) cb(payload)
    }
    ipcRenderer.on('event', listener)
    return () => ipcRenderer.removeListener('event', listener)
  },
  closeCapture(): void {
    ipcRenderer.send('capture-close')
  }
})
