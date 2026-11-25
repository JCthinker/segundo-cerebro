import { describe, expect, it } from 'vitest'
import { applyAliases, boardList, buildBoard, DEFAULT_PREFS, groupBoard, hiddenColumns, matches, withPositions, nextQuarter, quarterOf, readAgo, stageOf, taskReady, warningsFor, type JiraInitiative, type JiraSnapshot, type JiraTask } from '../src/shared/jira'

const ini = (p: Partial<JiraInitiative>): JiraInitiative => ({
  key: 'ROAD-1', title: 'Iniciativa', status: 'Backlog', quarter: null, url: null, developers: [], taskKeys: [], epicKey: null, updated: null, ...p
})
const task = (p: Partial<JiraTask>): JiraTask => ({
  key: 'FP-1', title: 'Tarea', status: 'To Do', url: null, hasDescription: true, estimated: true, epicKey: null, sprint: null, ...p
})
const snap = (p: Partial<JiraSnapshot>): JiraSnapshot => ({ at: '2026-11-24T10:00:00Z', initiatives: [], tasks: [], epics: [], ...p })

describe('stageOf', () => {
  it('reconoce los estados de ROAD sin importar mayúsculas ni espacios', () => {
    expect(stageOf('Backlog 3')).toBe('backlog3')
    expect(stageOf('BACKLOG')).toBe('backlog')
    expect(stageOf('Ready to Refine')).toBe('refine')
    expect(stageOf('ready-to-dev')).toBe('dev')
    expect(stageOf('WIP')).toBe('wip')
    expect(stageOf('Done')).toBe('done')
    expect(stageOf('Bloqueado')).toBe('other')
  })
})

describe('trimestres', () => {
  it('usa el formato de ROAD', () => {
    expect(quarterOf(new Date(2026, 10, 24))).toBe('Q4 - 2026')
    expect(nextQuarter(new Date(2026, 10, 24))).toBe('Q1 - 2027')
    expect(quarterOf(new Date(2027, 0, 1))).toBe('Q1 - 2027')
  })
})

describe('warningsFor', () => {
  it('avisa de un discovery sin desarrollador', () => {
    expect(warningsFor(ini({ status: 'Discovery' }), snap({})).map((w) => w.text)).toEqual(['Discovery sin desarrollador'])
    expect(warningsFor(ini({ status: 'Discovery', developers: ['Luis'] }), snap({}))).toEqual([])
  })

  it('en Ready to dev pide tareas FP, que estén listas y su épica', () => {
    expect(warningsFor(ini({ status: 'Ready to dev' }), snap({})).map((w) => w.text)).toEqual(['Sin tareas FP', 'Sin épica'])
    const s = snap({ tasks: [task({ key: 'FP-1' }), task({ key: 'FP-2', estimated: false })] })
    expect(warningsFor(ini({ status: 'Ready to dev', taskKeys: ['FP-1', 'FP-2'] }), s).map((w) => w.text)).toEqual(['1 FP sin preparar', 'Sin épica'])
  })

  it('avisa si la épica no tiene las mismas tareas que la iniciativa', () => {
    const s = snap({ tasks: [task({ key: 'FP-1' }), task({ key: 'FP-2' })], epics: [{ key: 'FP-9', title: 'Épica', url: null, roadKey: 'ROAD-1', taskKeys: ['FP-1'] }] })
    expect(warningsFor(ini({ status: 'Ready to dev', taskKeys: ['FP-1', 'FP-2'] }), s).map((w) => w.text)).toEqual(['La épica no cuadra'])
    s.epics[0].taskKeys = ['fp-2', 'FP-1']
    expect(warningsFor(ini({ status: 'WIP', taskKeys: ['FP-1', 'FP-2'] }), s)).toEqual([])
  })

  it('no avisa de nada en los pasos de backlog', () => {
    expect(warningsFor(ini({ status: 'Backlog 2' }), snap({}))).toEqual([])
  })
})

describe('buildBoard', () => {
  it('reparte por paso y pone primero lo del trimestre actual', () => {
    const s = snap({
      initiatives: [
        ini({ key: 'ROAD-1', status: 'Backlog', quarter: 'Q1 - 2027' }),
        ini({ key: 'ROAD-2', status: 'Backlog', quarter: 'Q4 - 2026' }),
        ini({ key: 'ROAD-3', status: 'Discovery', quarter: null, developers: ['Ana'] }),
        ini({ key: 'ROAD-4', status: 'En pausa' })
      ]
    })
    const board = buildBoard(s, new Date(2026, 10, 24))
    expect(board.find((c) => c.id === 'backlog')!.cards.map((c) => c.key)).toEqual(['ROAD-2', 'ROAD-1'])
    expect(board.find((c) => c.id === 'discovery')!.cards.map((c) => c.key)).toEqual(['ROAD-3'])
    expect(board.at(-1)!.id).toBe('other')
  })

  it('cuenta las FP hechas', () => {
    const s = snap({ initiatives: [ini({ status: 'WIP', taskKeys: ['FP-1', 'FP-2'] })], tasks: [task({ key: 'FP-1', status: 'Done' }), task({ key: 'FP-2' })] })
    expect(buildBoard(s, new Date(2026, 10, 24)).find((c) => c.id === 'wip')!.cards[0].tasksDone).toBe(1)
  })
})

describe('utilidades', () => {
  it('taskReady exige descripción y estimación', () => {
    expect(taskReady(task({}))).toBe(true)
    expect(taskReady(task({ hasDescription: false }))).toBe(false)
  })
  it('matches busca sin tildes', () => {
    expect(matches('ROAD-142 Factura mensual', 'factura')).toBe(true)
    expect(matches('Épica de pagos', 'epica')).toBe(true)
    expect(matches('Algo', 'otro')).toBe(false)
  })
  it('readAgo dice cuándo se leyó', () => {
    const now = new Date('2026-11-24T12:00:00Z')
    expect(readAgo('2026-11-24T11:55:00Z', now)).toBe('hace 5 min')
    expect(readAgo('2026-11-24T09:00:00Z', now)).toBe('hace 3 h')
    expect(readAgo('2026-11-23T10:00:00Z', now)).toBe('ayer')
  })
})

describe('personalizar', () => {
  it('los estados con otro nombre pasan a su paso', async () => {
    const { applyAliases, unknownStatuses } = await import('../src/shared/jira')
    const s = snap({ initiatives: [ini({ key: 'ROAD-1', status: 'En curso' }), ini({ key: 'ROAD-2', status: 'Bloqueado' })] })
    expect(unknownStatuses(s)).toEqual(['Bloqueado'])
    const t = applyAliases(s, { 'bloqueado ': 'wip', 'EN CURSO': 'wip' })
    expect(t.initiatives.map((i) => i.status)).toEqual(['WIP', 'WIP'])
    expect(unknownStatuses(t)).toEqual([])
  })
})

describe('orden por un campo de Jira', () => {
  const s = withPositions(
    snap({
      sortField: 'Prioridad',
      initiatives: [
        ini({ key: 'ROAD-7', status: 'WIP', quarter: 'Q1 - 2027', sortValue: 'Highest' }),
        ini({ key: 'ROAD-2', status: 'Backlog', quarter: 'Q1 - 2027', sortValue: 'High' }),
        ini({ key: 'ROAD-5', status: 'Backlog', quarter: 'Q4 - 2026', sortValue: 'Low' })
      ]
    })
  )

  it('dentro de cada paso respeta el orden de Jira, no el trimestre', () => {
    const board = buildBoard(s, new Date(2026, 10, 24))
    expect(board.find((c) => c.id === 'backlog')!.cards.map((c) => c.key)).toEqual(['ROAD-2', 'ROAD-5'])
  })

  it('la lista junta todos los pasos en el orden de Jira', () => {
    expect(boardList(s, buildBoard(s, new Date(2026, 10, 24))).map((c) => c.key)).toEqual(['ROAD-7', 'ROAD-2', 'ROAD-5'])
  })

  it('sin campo elegido, la lista sigue el orden de la app (trimestre actual y avisos primero)', () => {
    const plain = { ...s, sortField: '' }
    expect(boardList(plain, buildBoard(plain, new Date(2026, 10, 24))).map((c) => c.key)).toEqual(['ROAD-5', 'ROAD-7', 'ROAD-2'])
  })
})

describe('columnas según el criterio elegido', () => {
  const s = snap({
    initiatives: [
      ini({ key: 'ROAD-1', status: 'Discovery', quarter: 'Q1 - 2027', developers: ['Ana', 'Luis'] }),
      ini({ key: 'ROAD-2', status: 'Bloqueado', quarter: 'Q4 - 2026', developers: [] }),
      ini({ key: 'ROAD-3', status: 'Backlog', quarter: null, developers: ['Ana'], groupValue: 'Pagos' })
    ]
  })
  const today = new Date(2026, 10, 24)
  const cols = (by: Parameters<typeof groupBoard>[2]) => groupBoard(s, today, by).map((c) => `${c.label}:${c.cards.map((x) => x.key).join(',')}`)

  it('por Status: una columna por cada status real, los pasos de ROAD primero y en su orden', () => {
    expect(cols('status')).toEqual(['Backlog:ROAD-3', 'Discovery:ROAD-1', 'Bloqueado:ROAD-2'])
  })

  it('por Status usa el nombre real aunque lo hayas traducido a un paso', () => {
    const a = applyAliases(s, { Bloqueado: 'wip' })
    expect(groupBoard(a, today, 'status').map((c) => c.label)).toContain('Bloqueado')
    expect(groupBoard(a, today, 'stage').find((c) => c.label === 'WIP')!.cards.map((c) => c.key)).toEqual(['ROAD-2'])
  })

  it('por trimestre, en orden de fecha y «Sin trimestre» al final', () => {
    expect(cols('quarter')).toEqual(['Q4 - 2026:ROAD-2', 'Q1 - 2027:ROAD-1', 'Sin trimestre:ROAD-3'])
  })

  it('por desarrollador, una iniciativa con dos personas sale en las dos', () => {
    expect(cols('developer')).toEqual(['Ana:ROAD-1,ROAD-3', 'Luis:ROAD-1', 'Sin desarrollador:ROAD-2'])
  })

  it('por otro campo de Jira, con el valor leído', () => {
    expect(cols('field')).toEqual(['Pagos:ROAD-3', 'Sin valor:ROAD-2,ROAD-1'])
  })

  it('con pasos, por defecto oculta Backlog 2 y 3; con otro criterio, nada', () => {
    expect(hiddenColumns(DEFAULT_PREFS, 'stage')).toEqual(['Backlog 3', 'Backlog 2'])
    expect(hiddenColumns(DEFAULT_PREFS, 'status')).toEqual([])
    expect(hiddenColumns({ ...DEFAULT_PREFS, hiddenCols: { status: ['Done'] } }, 'status')).toEqual(['Done'])
  })
})
