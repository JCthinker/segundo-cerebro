import { globalShortcut } from 'electron'

let registered: string | null = null

const CANDIDATES = ['Alt+Space', 'CommandOrControl+Shift+Space', 'CommandOrControl+Alt+N']

/** Registra el atajo global de captura rápida con el primero que esté libre. */
export function registerCaptureShortcut(onPress: () => void): void {
  for (const acc of CANDIDATES) {
    try {
      if (globalShortcut.register(acc, onPress)) {
        registered = acc
        return
      }
    } catch {
      // sigue con el siguiente
    }
  }
}

export function shortcutLabel(): string | null {
  if (!registered) return null
  return registered
    .replace('CommandOrControl', process.platform === 'darwin' ? '⌘' : 'Ctrl')
    .replace('Alt', process.platform === 'darwin' ? '⌥' : 'Alt')
    .replace('Shift', '⇧')
    .replace('Space', 'Espacio')
    .replace(/\+/g, ' ')
}
