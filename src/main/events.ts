import { BrowserWindow } from 'electron'

/** Avisa a todas las ventanas (la principal y la de captura rápida). */
export function emit(name: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('event', name, payload)
  }
}

export const dataChanged = (what: string) => emit('data-changed', what)
