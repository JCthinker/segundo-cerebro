/**
 * Actualizaciones automáticas sin firma de Apple.
 *
 * Cada versión se publica en GitHub Releases como un .zip con la app
 * (ver scripts/release.sh). La app mira de vez en cuando si hay una versión
 * más nueva, la descarga y la deja preparada. Se instala al reiniciar
 * (con el aviso de la pantalla) o, si no, al salir de la app.
 *
 * La instalación la hace un pequeño script que espera a que la app se cierre,
 * cambia la app vieja por la nueva y, si se pidió, la vuelve a abrir.
 * Los datos (notas, ajustes) están en otra carpeta y no se tocan.
 */
import { app } from 'electron'
import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, constants, mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { UpdateStatus } from '@shared/types'
import { isNewer } from '@shared/version'
import { emit } from './events'

const REPO = 'JCthinker/segundo-cerebro'
const APP_NAME = 'Segundo Cerebro.app'
const EVERY_MS = 4 * 60 * 60 * 1000 // cada 4 horas
const run = promisify(execFile)

let status: UpdateStatus = { state: 'idle', current: app.getVersion() }
let readyApp: string | null = null // ruta de la app nueva ya descomprimida
let installing = false

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  emit('update-status', status)
}

export const updateStatus = (): UpdateStatus => status

/** /Applications/Segundo Cerebro.app (a partir de …/Contents/MacOS/Segundo Cerebro). */
function installedBundle(): string {
  return dirname(dirname(dirname(process.execPath)))
}

interface Release {
  tag_name: string
  body?: string
  draft?: boolean
  prerelease?: boolean
  assets: { name: string; browser_download_url: string; size: number; digest?: string | null }[]
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged || process.platform !== 'darwin') {
    set({ state: 'dev', detail: 'En modo desarrollo no se buscan actualizaciones.' })
    return status
  }
  if (status.state === 'checking' || status.state === 'downloading' || installing) return status
  if (status.state === 'ready' && readyApp) return status // ya hay una preparada

  set({ state: 'checking', detail: undefined })
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'segundo-cerebro-updater' }
    })
    if (res.status === 404) return done('idle', 'Todavía no hay versiones publicadas.')
    if (!res.ok) throw new Error(`GitHub respondió ${res.status}`)
    const rel = (await res.json()) as Release
    const version = rel.tag_name.replace(/^v/, '')
    if (!isNewer(version, status.current)) return done('idle', 'Tienes la última versión.')

    const asset = rel.assets.find((a) => a.name.endsWith(`-${process.arch}.zip`))
    if (!asset) return done('idle', `La versión ${version} no está disponible para este Mac (${process.arch}).`)

    await access(dirname(installedBundle()), constants.W_OK).catch(() => {
      throw new Error(`No tengo permiso para escribir en ${dirname(installedBundle())}. Mueve la app a Aplicaciones.`)
    })

    set({ state: 'downloading', version, detail: `Descargando la versión ${version}…` })
    readyApp = await download(asset, version)
    set({ state: 'ready', version, detail: `La versión ${version} está lista. Se instalará al reiniciar.`, checkedAt: new Date().toISOString() })
    return status
  } catch (e) {
    return done('error', `No se pudo buscar la actualización: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function done(state: UpdateStatus['state'], detail: string): UpdateStatus {
  set({ state, detail, checkedAt: new Date().toISOString() })
  return status
}

async function download(asset: Release['assets'][number], version: string): Promise<string> {
  const dir = join(app.getPath('temp'), `segundo-cerebro-update-${version}`)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const zip = join(dir, 'update.zip')

  const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'segundo-cerebro-updater' } })
  if (!res.ok) throw new Error(`La descarga falló (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (asset.size && buf.length !== asset.size) throw new Error('La descarga llegó incompleta')
  // GitHub da la huella sha256 de cada archivo: comprueba que es exactamente el publicado.
  if (asset.digest?.startsWith('sha256:')) {
    const got = createHash('sha256').update(buf).digest('hex')
    if (got !== asset.digest.slice(7)) throw new Error('La descarga no coincide con la publicada')
  }
  await writeFile(zip, buf)

  const out = join(dir, 'app')
  await run('/usr/bin/ditto', ['-x', '-k', zip, out])
  const bundle = join(out, APP_NAME)
  await stat(join(bundle, 'Contents', 'Info.plist')).catch(() => {
    throw new Error('El archivo descargado no contiene la app')
  })
  const plist = await readFile(join(bundle, 'Contents', 'Info.plist'), 'utf8')
  if (!plist.includes(`<string>${version}</string>`)) throw new Error('La app descargada no es la versión esperada')
  return bundle
}

/**
 * Cambia la app vieja por la nueva cuando la app se haya cerrado.
 * Con relaunch, la vuelve a abrir.
 */
function launchInstaller(relaunch: boolean): boolean {
  if (!readyApp || installing) return false
  installing = true
  const target = installedBundle()
  const script = `
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done
TARGET="$1"; NEW="$2"
rm -rf "$TARGET.old"
if mv "$TARGET" "$TARGET.old" && mv "$NEW" "$TARGET"; then
  rm -rf "$TARGET.old"
  xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
else
  [ -d "$TARGET" ] || mv "$TARGET.old" "$TARGET"
fi
${relaunch ? 'open "$TARGET"' : ''}
`
  const child = spawn('/bin/sh', ['-c', script, 'install', target, readyApp], { detached: true, stdio: 'ignore' })
  child.unref()
  return true
}

/** Reinicia ya para instalar la versión preparada. */
export function installNow(): boolean {
  if (!launchInstaller(true)) return false
  setImmediate(() => app.quit())
  return true
}

export function startUpdater(): void {
  setTimeout(() => void checkForUpdate(), 10_000)
  setInterval(() => void checkForUpdate(), EVERY_MS)
  // Si hay una versión preparada y sales de la app, se instala sola para la próxima vez.
  app.on('before-quit', () => {
    if (status.state === 'ready') launchInstaller(false)
  })
}
