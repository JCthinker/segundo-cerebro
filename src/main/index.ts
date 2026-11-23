import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, screen, shell } from 'electron'
import { join } from 'node:path'
import { openDb } from './db'
import { registerIpc } from './ipc'
import { startScheduler } from './scheduler'
import { enabledConnectorNames } from './agent/connectors'
import { agentEnv } from './agent/client'
import { registerCaptureShortcut } from './shortcut'
import { startUpdater } from './updater'

const here = import.meta.dirname

// Carpeta de datos alternativa (útil para probar sin tocar tus datos reales).
if (process.env.CEREBRO_DATA_DIR) app.setPath('userData', process.env.CEREBRO_DATA_DIR)
let main: BrowserWindow | null = null
let captureWin: BrowserWindow | null = null

function load(win: BrowserWindow, hash = ''): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}${hash ? '#' + hash : ''}`)
  else void win.loadFile(join(here, '../renderer/index.html'), { hash })
}

const webPreferences = {
  preload: join(here, '../preload/index.mjs'),
  sandbox: false,
  contextIsolation: true,
  nodeIntegration: false
}

function createMain(): void {
  main = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Segundo cerebro',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1e1d' : '#faf9f5',
    webPreferences
  })
  main.once('ready-to-show', () => main?.show())
  main.on('closed', () => (main = null))
  main.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  load(main)
}

function toggleCapture(): void {
  if (captureWin && !captureWin.isDestroyed()) {
    if (captureWin.isVisible()) captureWin.hide()
    else {
      captureWin.show()
      captureWin.focus()
    }
    return
  }
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  captureWin = new BrowserWindow({
    width: 600,
    height: 220,
    x: Math.round(workArea.x + (workArea.width - 600) / 2),
    y: Math.round(workArea.y + workArea.height * 0.22),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    transparent: process.platform === 'darwin',
    vibrancy: process.platform === 'darwin' ? 'popover' : undefined,
    webPreferences
  })
  captureWin.once('ready-to-show', () => {
    captureWin?.show()
    captureWin?.focus()
  })
  captureWin.on('blur', () => captureWin?.hide())
  load(captureWin, 'capture')
}

app.whenReady().then(() => {
  app.setName('Segundo cerebro')
  openDb(join(app.getPath('userData'), 'cerebro.db'))
  registerIpc()
  createMain()
  registerCaptureShortcut(toggleCapture)
  startScheduler()
  startUpdater()
  // Busca ya las conexiones de claude.ai para que la primera pregunta no tenga que esperar.
  setTimeout(() => {
    try {
      void enabledConnectorNames(agentEnv()).catch(() => undefined)
    } catch {
      // Sin API key o sin sesión: se buscarán cuando haga falta.
    }
  }, 3000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().filter((w) => w !== captureWin).length === 0) createMain()
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// La ventana de captura pide cerrarse a sí misma.
ipcMain.on('capture-close', () => captureWin?.hide())
