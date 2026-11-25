import { applyAliases, DEFAULT_PREFS, withPositions, type JiraPrefs, type JiraSnapshot } from '@shared/jira'
import { isReadOnlyTool } from '@shared/permissions'
import * as db from './db'
import { dataChanged } from './events'
import { getSettings } from './settings'
import { baseSystem } from './agent/context'
import { agentEnv, friendlyError, markAiFailure, markAiOk, runAgent, setupError } from './agent/client'
import { connectorLabel, enabledConnectorNames } from './agent/connectors'

/**
 * Copia de Jira (ROAD y FP) leída a través de la conexión de Jira/Atlassian de claude.ai.
 * La lee el modelo barato, solo con herramientas de lectura, y se guarda en la app
 * para que las pantallas carguen al momento y los avisos se calculen sin IA.
 */

const SNAPSHOT_KEY = 'jira.snapshot'
const ERROR_KEY = 'jira.error'
/** Cada cuánto se vuelve a leer sola mientras la app está abierta. */
export const JIRA_EVERY = 3 * 60 * 60_000

export function jiraPrefs(): JiraPrefs {
  let saved: Partial<JiraPrefs> = {}
  try {
    saved = JSON.parse(db.getSetting('jira.prefs') ?? '{}') as Partial<JiraPrefs>
  } catch {
    saved = {}
  }
  return {
    ...DEFAULT_PREFS,
    road: db.getSetting('jira.road') || DEFAULT_PREFS.road,
    fp: db.getSetting('jira.fp') || DEFAULT_PREFS.fp,
    ...saved
  }
}

/** Guarda cómo quieres ver Jira. Devuelve true si hay que volver a leerlo (cambian proyectos o filtro). */
export function saveJiraPrefs(p: JiraPrefs): boolean {
  const before = jiraPrefs()
  const clean: JiraPrefs = {
    road: p.road.trim().toUpperCase() || 'ROAD',
    fp: p.fp.trim().toUpperCase() || 'FP',
    filter: p.filter.trim(),
    hidden: p.hidden,
    aliases: p.aliases,
    sortField: (p.sortField ?? '').trim(),
    sortDesc: !!p.sortDesc,
    view: p.view === 'list' ? 'list' : 'board'
  }
  db.setSetting('jira.prefs', JSON.stringify(clean))
  dataChanged('jira')
  return (
    before.road !== clean.road ||
    before.fp !== clean.fp ||
    before.filter !== clean.filter ||
    before.sortField !== clean.sortField ||
    (!!clean.sortField && before.sortDesc !== clean.sortDesc)
  )
}

export function jiraProjects(): { road: string; fp: string } {
  const p = jiraPrefs()
  return { road: p.road, fp: p.fp }
}

export function isJiraConnector(name: string): boolean {
  return /atlassian|jira/i.test(connectorLabel(name))
}

export async function jiraConnector(): Promise<string | null> {
  if (getSettings().aiMode === 'api-key') return null
  const names = await enabledConnectorNames(agentEnv()).catch(() => [] as string[])
  return names.find(isJiraConnector) ?? null
}

/** La copia de Jira, con tus estados renombrados ya traducidos a los pasos de ROAD. */
export function getSnapshot(): JiraSnapshot | null {
  const raw = db.getSetting(SNAPSHOT_KEY)
  if (!raw) return null
  try {
    return applyAliases(JSON.parse(raw) as JiraSnapshot, jiraPrefs().aliases)
  } catch {
    return null
  }
}

export function lastJiraError(): string | null {
  return db.getSetting(ERROR_KEY)
}

let running: Promise<JiraSnapshot> | null = null
export const jiraSyncing = () => !!running

const str = { type: 'string' } as const
const strOrNull = { type: ['string', 'null'] } as const

const SNAPSHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['initiatives', 'tasks', 'epics'],
  properties: {
    initiatives: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'status', 'quarter', 'url', 'developers', 'taskKeys', 'epicKey', 'updated', 'kpi', 'sortValue'],
        properties: {
          key: str,
          title: str,
          status: { type: 'string', description: 'Nombre exacto del estado en Jira' },
          quarter: { ...strOrNull, description: 'Valor del campo Quarter, p. ej. «Q1 - 2027»' },
          url: strOrNull,
          developers: { type: 'array', items: str, description: 'Desarrolladores que participan (responsable u otros asignados)' },
          taskKeys: { type: 'array', items: str, description: 'Claves de las tareas FP relacionadas' },
          epicKey: { ...strOrNull, description: 'Épica de FP que replica esta iniciativa' },
          updated: { ...strOrNull, description: 'Última actualización, ISO 8601' },
          kpi: { ...strOrNull, description: 'El KPI o métrica que se quiere mover, tal como aparece en la descripción o en un campo; null si no lo hay' },
          sortValue: { ...strOrNull, description: 'Valor del campo por el que se ordena, tal como lo muestra Jira; null si no se pidió orden o está vacío' }
        }
      }
    },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'status', 'url', 'hasDescription', 'estimated', 'epicKey', 'sprint'],
        properties: {
          key: str,
          title: str,
          status: str,
          url: strOrNull,
          hasDescription: { type: 'boolean', description: 'Tiene una descripción con contenido real' },
          estimated: { type: 'boolean', description: 'Tiene puntos de historia o estimación' },
          epicKey: strOrNull,
          sprint: { ...strOrNull, description: 'Nombre del sprint activo o futuro en el que está' }
        }
      }
    },
    epics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'url', 'roadKey', 'taskKeys'],
        properties: {
          key: str,
          title: str,
          url: strOrNull,
          roadKey: { ...strOrNull, description: 'Iniciativa de ROAD que replica' },
          taskKeys: { type: 'array', items: str }
        }
      }
    }
  }
} as const

function role(road: string, fp: string, filter = '', sortField = '', sortDesc = false): string {
  const dir = sortDesc ? 'DESC' : 'ASC'
  const order = sortField
    ? `ORDEN: devuelve las iniciativas de ${road} EXACTAMENTE en el orden que da Jira con «ORDER BY "${sortField}" ${dir}» (si ese campo no existe con ese nombre, busca el campo que más se le parezca, como Prioridad/Priority o Rank/Clasificación, y úsalo). Respeta ese orden en la lista "initiatives", también al paginar. En "sortValue" pon el valor de ese campo tal como lo muestra Jira.\n\n`
    : 'En "sortValue" pon siempre null.\n\n'
  return `Eres el lector de Jira del «segundo cerebro». Usa SOLO herramientas de lectura de Jira. No crees, cambies ni borres nada.

Tienes que devolver una copia resumida de dos proyectos:
1. Proyecto ${road} (iniciativas de producto): todas las que no están en Done, y las que pasaron a Done en los últimos 120 días.
   Por ejemplo, con JQL: project = ${road} AND (statusCategory != Done OR updated >= -120d)
   - "status": el nombre exacto del estado (Backlog 3, Backlog 2, Backlog, Discovery, Ready to refine, Ready to dev, WIP, Done…).
   - "quarter": el valor del campo personalizado llamado Quarter (formato «Q1 - 2027»), o null.
   - "developers": el responsable y cualquier desarrollador asignado o mencionado como participante en los campos del ticket.
   - "kpi": el KPI o métrica que la iniciativa quiere mover, si está en la descripción o en un campo (resúmelo en pocas palabras).
   - "taskKeys": las tareas de ${fp} relacionadas (por enlaces entre tickets, por su épica o porque las mencionan).
2. Proyecto ${fp} (tareas técnicas y épicas): las que no están terminadas y las terminadas en los últimos 30 días.
   Por ejemplo: project = ${fp} AND (statusCategory != Done OR updated >= -30d)
   - Las épicas (tipo Epic) van en "epics", con la iniciativa de ${road} que replican y las tareas que tienen dentro.
   - El resto va en "tasks". "hasDescription" es true si la descripción tiene contenido real; "estimated" si tiene puntos o estimación.

${filter ? `Aplica además este filtro a las dos consultas: AND (${filter})\n\n` : ''}${order}Pide a Jira solo los campos que necesitas y pagina hasta tenerlo todo. No inventes datos: si no sabes algo, pon null o una lista vacía.`
}

/** Lee Jira y guarda la copia. Si ya se está leyendo, espera a esa lectura. */
export function syncJira(): Promise<JiraSnapshot> {
  if (!running) {
    running = doSync().finally(() => {
      running = null
      dataChanged('jira')
    })
    dataChanged('jira')
  }
  return running
}

async function doSync(): Promise<JiraSnapshot> {
  const connector = await jiraConnector()
  if (!connector) throw setupError('Tu cuenta de Claude no tiene Jira conectado. Conéctalo en claude.ai → Ajustes → Conectores → Atlassian (Jira) y vuelve a intentarlo.')
  const { road, fp } = jiraProjects()
  const prefs = jiraPrefs()
  try {
    const r = await runAgent({
      system: baseSystem(role(road, fp, prefs.filter, prefs.sortField, prefs.sortDesc)),
      prompt: `Lee ${road} y ${fp} y devuelve la copia.`,
      connectors: [connector],
      canUseTool: async (toolName, input) =>
        isReadOnlyTool(toolName)
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: 'Esta lectura de Jira es de solo lectura.' },
      outputSchema: SNAPSHOT_SCHEMA as unknown as Record<string, unknown>,
      tier: 'quick',
      effort: 'low',
      maxTurns: 40
    })
    const data = r.structured as Omit<JiraSnapshot, 'at'> | null
    if (!data) throw new Error('Claude no devolvió los datos de Jira.')
    const snap: JiraSnapshot = withPositions({ at: new Date().toISOString(), ...data, sortField: prefs.sortField, sortDesc: prefs.sortDesc })
    db.setSetting(SNAPSHOT_KEY, JSON.stringify(snap))
    db.setSetting(ERROR_KEY, null)
    markAiOk()
    return snap
  } catch (e) {
    markAiFailure(e)
    db.setSetting(ERROR_KEY, friendlyError(e))
    throw new Error(friendlyError(e))
  }
}

/** Para el programador: vuelve a leer si la copia tiene más de 3 horas. */
export async function maybeSyncJira(): Promise<void> {
  const snap = getSnapshot()
  if (snap && Date.now() - new Date(snap.at).getTime() < JIRA_EVERY) return
  if (!(await jiraConnector())) return
  await syncJira().catch(() => undefined)
}

export interface JiraGuess {
  road: string | null
  fp: string | null
  /** Estados de las iniciativas y el paso de ROAD al que corresponden. */
  statuses: { status: string; stage: string }[]
  note: string
}

const GUESS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['road', 'fp', 'statuses', 'note'],
  properties: {
    road: { ...strOrNull, description: 'Clave del proyecto de iniciativas de producto (roadmap)' },
    fp: { ...strOrNull, description: 'Clave del proyecto de tareas técnicas y épicas del equipo' },
    statuses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'stage'],
        properties: {
          status: str,
          stage: { type: 'string', enum: ['backlog3', 'backlog2', 'backlog', 'discovery', 'refine', 'dev', 'wip', 'done', 'other'] }
        }
      }
    },
    note: { type: 'string', description: 'Una o dos frases: qué has visto y qué conviene revisar' }
  }
} as const

/** Claude mira tu Jira (solo lectura) y propone proyectos y a qué paso corresponde cada estado. */
export async function guessJira(): Promise<JiraGuess> {
  const connector = await jiraConnector()
  if (!connector) throw setupError('Tu cuenta de Claude no tiene Jira conectado. Conéctalo en claude.ai → Ajustes → Conectores → Atlassian (Jira) y vuelve a intentarlo.')
  const p = jiraPrefs()
  const r = await runAgent({
    system: baseSystem(`Miras el Jira del usuario, un product manager, usando SOLO herramientas de lectura. Sus pasos de producto son: Backlog 3, Backlog 2, Backlog, Discovery, Ready to refine, Ready to dev, WIP, Done. Encuentra su proyecto de iniciativas (ahora cree que es ${p.road}) y el de tareas técnicas y épicas (ahora ${p.fp}), y lista los estados que usan las iniciativas con el paso al que corresponde cada uno.`),
    prompt: 'Deduce la configuración.',
    connectors: [connector],
    canUseTool: async (toolName, input) =>
      isReadOnlyTool(toolName) ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Solo lectura.' },
    outputSchema: GUESS_SCHEMA as unknown as Record<string, unknown>,
    tier: 'quick',
    effort: 'low',
    maxTurns: 15
  })
  const out = r.structured as JiraGuess | null
  if (!out) throw new Error('Claude no pudo deducir la configuración.')
  return out
}
