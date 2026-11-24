import type { JiraSnapshot } from '@shared/jira'
import { isReadOnlyTool } from '@shared/permissions'
import * as db from './db'
import { dataChanged } from './events'
import { getSettings } from './settings'
import { baseSystem } from './agent/context'
import { agentEnv, friendlyError, markAiFailure, markAiOk, runAgent } from './agent/client'
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

export function jiraProjects(): { road: string; fp: string } {
  return { road: db.getSetting('jira.road') || 'ROAD', fp: db.getSetting('jira.fp') || 'FP' }
}

export function isJiraConnector(name: string): boolean {
  return /atlassian|jira/i.test(connectorLabel(name))
}

export async function jiraConnector(): Promise<string | null> {
  if (getSettings().aiMode === 'api-key') return null
  const names = await enabledConnectorNames(agentEnv()).catch(() => [] as string[])
  return names.find(isJiraConnector) ?? null
}

export function getSnapshot(): JiraSnapshot | null {
  const raw = db.getSetting(SNAPSHOT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as JiraSnapshot
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
        required: ['key', 'title', 'status', 'quarter', 'url', 'developers', 'taskKeys', 'epicKey', 'updated'],
        properties: {
          key: str,
          title: str,
          status: { type: 'string', description: 'Nombre exacto del estado en Jira' },
          quarter: { ...strOrNull, description: 'Valor del campo Quarter, p. ej. «Q1 - 2027»' },
          url: strOrNull,
          developers: { type: 'array', items: str, description: 'Desarrolladores que participan (responsable u otros asignados)' },
          taskKeys: { type: 'array', items: str, description: 'Claves de las tareas FP relacionadas' },
          epicKey: { ...strOrNull, description: 'Épica de FP que replica esta iniciativa' },
          updated: { ...strOrNull, description: 'Última actualización, ISO 8601' }
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

function role(road: string, fp: string): string {
  return `Eres el lector de Jira del «segundo cerebro». Usa SOLO herramientas de lectura de Jira. No crees, cambies ni borres nada.

Tienes que devolver una copia resumida de dos proyectos:
1. Proyecto ${road} (iniciativas de producto): todas las que no están en Done, y las que pasaron a Done en los últimos 120 días.
   Por ejemplo, con JQL: project = ${road} AND (statusCategory != Done OR updated >= -120d)
   - "status": el nombre exacto del estado (Backlog 3, Backlog 2, Backlog, Discovery, Ready to refine, Ready to dev, WIP, Done…).
   - "quarter": el valor del campo personalizado llamado Quarter (formato «Q1 - 2027»), o null.
   - "developers": el responsable y cualquier desarrollador asignado o mencionado como participante en los campos del ticket.
   - "taskKeys": las tareas de ${fp} relacionadas (por enlaces entre tickets, por su épica o porque las mencionan).
2. Proyecto ${fp} (tareas técnicas y épicas): las que no están terminadas y las terminadas en los últimos 30 días.
   Por ejemplo: project = ${fp} AND (statusCategory != Done OR updated >= -30d)
   - Las épicas (tipo Epic) van en "epics", con la iniciativa de ${road} que replican y las tareas que tienen dentro.
   - El resto va en "tasks". "hasDescription" es true si la descripción tiene contenido real; "estimated" si tiene puntos o estimación.

Pide a Jira solo los campos que necesitas y pagina hasta tenerlo todo. No inventes datos: si no sabes algo, pon null o una lista vacía.`
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
  if (!connector) throw new Error('No hay conexión de Jira. Actívala en Ajustes → Entradas → De tu cuenta de Claude.')
  const { road, fp } = jiraProjects()
  try {
    const r = await runAgent({
      system: baseSystem(role(road, fp)),
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
    const snap: JiraSnapshot = { at: new Date().toISOString(), ...data }
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
