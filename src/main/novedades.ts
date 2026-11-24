import { randomUUID } from 'node:crypto'
import { acceptNews, rememberSeen, type NewsEntry, type NewsTarget } from '@shared/news'
import { isReadOnlyTool } from '@shared/permissions'
import * as db from './db'
import { dataChanged } from './events'
import { getSettings } from './settings'
import { baseSystem } from './agent/context'
import { agentEnv, runAgent } from './agent/client'
import { connectorLabel, enabledConnectorNames } from './agent/connectors'
import { isCalendarConnector } from './sources'
import { getSnapshot } from './jira'
import { learn } from './learning'

/**
 * Cada pocas horas, el modelo barato lee solo lo que no ha visto antes en tus herramientas
 * y propone qué hacer con cada cosa: añadirla a una tarea o iniciativa, crear un encargo,
 * llevarla a producto o ignorarla. Tú decides en la caja de Novedades.
 */

const PENDING = 'news.pending'
const SEEN = 'news.seen'
const LAST = 'news.lastAt'
/** Cada cuánto se repasa sola mientras la app está abierta. */
export const NEWS_EVERY = 2 * 60 * 60_000

const read = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(db.getSetting(key) ?? '') as T
  } catch {
    return fallback
  }
}

export const pendingNews = (): NewsEntry[] => read<NewsEntry[]>(PENDING, [])
const savePending = (l: NewsEntry[]) => db.setSetting(PENDING, JSON.stringify(l.slice(0, 60)))
export const lastNewsAt = (): string | null => db.getSetting(LAST)

const NEWS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['news'],
  properties: {
    news: {
      type: 'array',
      maxItems: 25,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ref', 'tool', 'from', 'summary', 'action', 'targetKind', 'targetId', 'title', 'why'],
        properties: {
          ref: { type: 'string', description: 'Enlace o identificador único del mensaje, correo, documento o ticket' },
          tool: { type: 'string' },
          from: { type: ['string', 'null'], description: 'Quién lo escribe o lo pide' },
          summary: { type: 'string', description: 'Qué ha pasado, en una frase' },
          action: { type: 'string', enum: ['add', 'encargo', 'product', 'noise'] },
          targetKind: { type: ['string', 'null'], enum: ['item', 'road', null] },
          targetId: { type: ['string', 'null'], description: 'Para add: id de «misCosas» o clave ROAD de «iniciativas»' },
          title: { type: ['string', 'null'], description: 'Para encargo o product: título corto' },
          why: { type: 'string', description: 'Por qué lo propones, en pocas palabras' }
        }
      }
    }
  }
} as const

const ROLE = `Lees lo NUEVO en las herramientas del usuario, un product manager, usando SOLO herramientas de lectura, y lo clasificas.
Mira lo ocurrido desde «desde» (o las últimas 24 horas). Salta todo lo que esté en «yaVisto». Sé breve: mensajes dirigidos a él, menciones, correos de personas, documentos compartidos, cambios en Jira que le afecten.
Para cada cosa elige:
- add: aporta contexto a algo que ya existe. Pon targetKind «item» con un id de «misCosas», o «road» con una clave de «iniciativas».
- encargo: alguien le pide algo a él. title = qué tiene que hacer.
- product: es un problema, idea o petición para el producto que no encaja en ninguna iniciativa (posible iniciativa nueva para ROAD). title = el problema.
- noise: no requiere nada (notificaciones, saludos, cosas ya resueltas). Inclúyelo igualmente con su ref para no volver a leerlo.
No escribas ni envíes nada.`

let running: Promise<number> | null = null
export const newsRunning = () => !!running

export function reviewNews(): Promise<number> {
  if (!running)
    running = doReview().finally(() => {
      running = null
      dataChanged('news')
    })
  dataChanged('news')
  return running
}

async function doReview(): Promise<number> {
  if (getSettings().aiMode === 'api-key') return 0
  const names = (await enabledConnectorNames(agentEnv())).filter((n) => !isCalendarConnector(n))
  if (!names.length) throw new Error('No hay herramientas conectadas para leer. Actívalas en Ajustes → Entradas → De tu cuenta de Claude.')
  const seen = read<string[]>(SEEN, [])
  const items = db.listItems({ status: ['active'] }).slice(0, 80)
  const snap = getSnapshot()
  const data = {
    desde: lastNewsAt(),
    herramientas: names.map(connectorLabel),
    yaVisto: seen.slice(0, 200),
    misCosas: items.map((i) => ({ id: i.id, titulo: i.title, persona: i.person })),
    iniciativas: snap?.initiatives.filter((i) => !/done/i.test(i.status)).map((i) => ({ clave: i.key, titulo: i.title, estado: i.status })) ?? []
  }
  const startedAt = new Date().toISOString()
  const r = await runAgent({
    system: baseSystem(ROLE),
    prompt: JSON.stringify(data, null, 2),
    connectors: names,
    canUseTool: async (toolName, input) =>
      isReadOnlyTool(toolName) ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Este repaso es de solo lectura.' },
    outputSchema: NEWS_SCHEMA as unknown as Record<string, unknown>,
    tier: 'quick',
    effort: 'low',
    maxTurns: 30
  })
  type Raw = { ref: string; tool: string; from: string | null; summary: string; action: NewsEntry['action']; targetKind: 'item' | 'road' | null; targetId: string | null; title: string | null; why: string }
  const raw = (r.structured as { news: Raw[] } | null)?.news ?? []
  const target = (x: Raw): NewsTarget | null => {
    if (x.targetKind === 'item' && x.targetId) {
      const it = items.find((i) => i.id === x.targetId)
      return it ? { kind: 'item', id: it.id, title: it.title } : null
    }
    if (x.targetKind === 'road' && x.targetId) {
      const ini = snap?.initiatives.find((i) => i.key === x.targetId)
      return ini ? { kind: 'road', id: ini.key, title: ini.title } : null
    }
    return null
  }
  const entries: NewsEntry[] = raw.map((x) => {
    const t = target(x)
    // Si propone añadir a algo que no existe, mejor que lo decida el usuario como encargo.
    const action = x.action === 'add' && !t ? 'encargo' : x.action
    return { id: randomUUID(), at: startedAt, ref: x.ref, tool: x.tool, from: x.from, summary: x.summary, action, target: t, title: x.title ?? x.summary, why: x.why }
  })
  const pending = pendingNews()
  const fresh = acceptNews(entries, pending, seen)
  savePending([...fresh, ...pending])
  db.setSetting(SEEN, JSON.stringify(rememberSeen(seen, raw.map((x) => x.ref))))
  db.setSetting(LAST, startedAt)
  return fresh.length
}

/** Para el programador: repasa si hace más de 2 horas. */
export async function maybeReviewNews(): Promise<void> {
  const last = lastNewsAt()
  if (last && Date.now() - new Date(last).getTime() < NEWS_EVERY) return
  await reviewNews().catch(() => undefined)
}

export type NewsDecision =
  | { how: 'accept' }
  | { how: 'retarget'; target: NewsTarget }
  | { how: 'asEncargo' }
  | { how: 'dismiss'; reason?: string }

/**
 * Lo que decides con cada novedad. Devuelve, si hace falta, el mensaje para que Claude
 * lo haga en Jira (con tu OK).
 */
export function decideNews(id: string, d: NewsDecision): { talk: string | null } {
  const all = pendingNews()
  const n = all.find((x) => x.id === id)
  if (!n) return { talk: null }
  savePending(all.filter((x) => x.id !== id))
  const ctx = `${n.summary}${n.from ? ` (${n.from}, ${n.tool})` : ` (${n.tool})`}`
  let talk: string | null = null

  const addTo = (t: NewsTarget) => {
    if (t.kind === 'item') {
      const it = db.getItem(t.id)
      if (it) db.updateItem(it.id, { context: [it.context, `· ${ctx} — ${n.ref}`].filter(Boolean).join('\n') })
    } else talk = `Añade este contexto como comentario en ${t.id} «${t.title}»: ${ctx}. Origen: ${n.ref}. Enséñame el comentario y pídeme OK antes de escribirlo.`
  }

  if (d.how === 'accept') {
    if (n.action === 'add' && n.target) addTo(n.target)
    else if (n.action === 'encargo') createEncargo(n)
    else if (n.action === 'product')
      talk = `Me ha llegado esto que puede ser una iniciativa nueva para ROAD: «${n.title}». ${ctx}. Origen: ${n.ref}. Mira si encaja en alguna iniciativa existente; si no, propónme cómo crearla en Backlog (problema, KPI) y pídeme OK antes de escribir en Jira.`
  } else if (d.how === 'retarget') {
    addTo(d.target)
    learn('novedades', `Claude propuso «${n.action === 'add' && n.target ? `añadir a ${n.target.title}` : n.action}» para «${n.summary}», pero el usuario lo llevó a ${d.target.kind === 'road' ? d.target.id : 'su tarea'} «${d.target.title}».`)
  } else if (d.how === 'asEncargo') {
    createEncargo(n)
    if (n.action !== 'encargo') learn('novedades', `Para «${n.summary}» Claude propuso «${n.action}», pero era un encargo.`)
  } else {
    learn('novedades', `Descartó «${n.summary}» (${n.tool}${n.from ? `, de ${n.from}` : ''})${d.reason ? `: ${d.reason}` : ''}.`)
  }
  dataChanged('news')
  dataChanged('items')
  return { talk }
}

function createEncargo(n: NewsEntry) {
  db.createItem({ kind: 'promise', title: n.title ?? n.summary, person: n.from, status: 'active', sourceType: 'mcp', sourceRef: n.ref, sourceTool: n.tool, context: n.summary })
}

