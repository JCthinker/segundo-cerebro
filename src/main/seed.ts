import { addDays, toDay } from '@shared/dates'
import * as db from './db'

/** Plantilla de Mi flujo para quien empieza de cero. */
export const WORKFLOW_TEMPLATE = `# Cómo trabajo

Esta página la escribes tú. Claude la lee antes de cada brief y cada vez que resuelve algo por ti, como si fuera un skill. Escribe en lenguaje normal; no hace falta ningún formato especial salvo en «Permisos».

## Quién soy
- Mi rol y a qué me dedico.
- Mi horario habitual.

## Prioridades
1. Lo más importante este trimestre.
2. Lo que no se mueve (salud, familia…).

## Reglas
- Si no llego a una promesa, aviso con 2 días de antelación.
- Si un día tiene más de 3 reuniones, no planifiques trabajo profundo.
- Los viernes por la tarde, cierre semanal.

## Personas clave
- Nombre: qué suele pedir y con qué plazo.

## Permisos
Qué puede hacer Claude con tus herramientas. Una línea por herramienta o servidor: automático, requiere OK, solo borrador o prohibido. Sin regla, leer es automático y escribir requiere tu OK.
- cerebro: automático
- *delete*: prohibido
`

const DEMO_WORKFLOW = `# Cómo trabajo

## Quién soy
- Lucía, product manager en una agencia pequeña. Llevo dos clientes grandes.
- Trabajo de 9:30 a 18:00. Los viernes salgo a las 15:00.

## Prioridades
1. Cliente X por encima de todo hasta marzo: es la cuenta que más factura.
2. Salud: entreno lunes, miércoles y viernes a las 8:00. No se mueve.
3. Formación: un rato a la semana para el curso de análisis de datos.

## Reglas
- Nada de reuniones antes de las 10.
- Si no llego a una promesa, aviso con 2 días de antelación.
- Si un día tiene más de 3 reuniones, no planifiques trabajo profundo.
- Lo que me pida Marta suele tener 48 horas de plazo.
- Los viernes a las 14:00, cierre semanal: revisar promesas y entregas.

## Rituales
- Lunes: planificar la semana.
- Viernes: cierre semanal.

## Personas clave
- Ana (Cliente X): directora de marketing, quiere los informes en PDF.
- Marta (equipo): diseño; pide feedback rápido.
- Luis (finanzas del cliente Y): presupuestos y facturas.

## Permisos
- cerebro: automático
- jira: automático
- slack: requiere OK
- gmail: solo borrador
- *delete*: prohibido
`

export function seedTemplateOnly(): void {
  db.saveWorkflow(WORKFLOW_TEMPLATE)
  db.upsertArea({ id: 'trabajo', name: 'Trabajo', weight: 1 })
  db.upsertArea({ id: 'personal', name: 'Personal', weight: 1 })
}

export function seedDemo(): void {
  const today = toDay(new Date())
  db.saveWorkflow(DEMO_WORKFLOW)

  db.upsertArea({ id: 'cliente-x', name: 'Cliente X', weight: 1.5 })
  db.upsertArea({ id: 'trabajo', name: 'Trabajo', weight: 1 })
  db.upsertArea({ id: 'personal', name: 'Personal', weight: 1 })
  db.upsertArea({ id: 'admin', name: 'Administración', weight: 0.7 })

  const n1 = db.createNote('Reunión con Ana: informe trimestral')
  const n1Text = `Reunión con Ana (Cliente X).
Le he dicho que le mando el informe trimestral en PDF antes del ${addDays(today, 1)}.
Decidimos centrar la campaña de enero en el canal de email.
Tengo que preparar la propuesta de enero; la entrega es el ${addDays(today, 8)} y necesita unos 5 días.`
  db.saveNote(n1.id, n1.title, toDoc(n1Text), n1Text)
  db.markNoteExtracted(n1.id)

  const n2 = db.createNote('Ideas sueltas')
  const n2Text = `Reordenar la carpeta de Drive del equipo.
Mirar el curso de análisis de datos, módulo 3.
Luis me pidió el presupuesto del cliente Y, le dije que antes del jueves.`
  db.saveNote(n2.id, n2.title, toDoc(n2Text), n2Text)

  db.createItem({
    kind: 'promise', title: 'Enviar el informe trimestral a Ana', person: 'Ana', dueDate: addDays(today, 1),
    areaId: 'cliente-x', sourceType: 'note', sourceRef: n1.id,
    sourceSnippet: 'Le he dicho que le mando el informe trimestral en PDF antes del…'
  })
  db.createItem({
    kind: 'deadline', title: 'Propuesta de campaña de enero', dueDate: addDays(today, 8), prepDays: 5,
    areaId: 'cliente-x', sourceType: 'note', sourceRef: n1.id,
    sourceSnippet: 'la entrega es el… y necesita unos 5 días'
  })
  db.createItem({
    kind: 'decision', title: 'La campaña de enero se centra en email', areaId: 'cliente-x',
    sourceType: 'note', sourceRef: n1.id, sourceSnippet: 'Decidimos centrar la campaña de enero en el canal de email.'
  })
  db.createItem({ kind: 'task', title: 'Preparar la demo de esta tarde', dueDate: today, areaId: 'trabajo', sourceType: 'manual' })
  db.createItem({ kind: 'promise', title: 'Dar feedback a Marta sobre las maquetas', person: 'Marta', dueDate: addDays(today, -1), areaId: 'trabajo', sourceType: 'capture', sourceSnippet: 'le paso feedback mañana' })
  db.createItem({ kind: 'task', title: 'Reordenar la carpeta de Drive', areaId: 'admin', sourceType: 'note', sourceRef: n2.id })
  db.createItem({ kind: 'task', title: 'Curso de análisis de datos, módulo 3', dueDate: addDays(today, 12), areaId: 'personal', sourceType: 'note', sourceRef: n2.id })
  db.createItem({
    kind: 'promise', title: 'Mandar a Luis el presupuesto del cliente Y', person: 'Luis', dueDate: addDays(today, 4),
    status: 'proposed', sourceType: 'note', sourceRef: n2.id, sourceSnippet: 'Luis me pidió el presupuesto del cliente Y, le dije que antes del jueves.'
  })
  db.createItem({
    kind: 'deadline', title: 'Informe anual', dueDate: addDays(today, 23), prepDays: 7, status: 'proposed',
    sourceType: 'file', sourceRef: 'Calendario Q4.pdf', sourceSnippet: 'pág. 2: entrega del informe anual'
  })

  const demoSource = db.upsertSource({ kind: 'ics', name: 'Calendario de ejemplo', config: { url: '', demo: true }, enabled: true })
  const at = (dayOffset: number, h: number, m = 0) => {
    const d = new Date()
    d.setDate(d.getDate() + dayOffset)
    d.setHours(h, m, 0, 0)
    return d.toISOString()
  }
  db.replaceEvents(demoSource.id, [
    { id: 'demo-1', sourceId: demoSource.id, title: 'Standup del equipo', start: at(0, 10), end: at(0, 10, 15), allDay: false, location: null, attendees: ['Marta', 'Pablo'], description: null },
    { id: 'demo-2', sourceId: demoSource.id, title: 'Revisión de campaña con Ana', start: at(0, 12), end: at(0, 13), allDay: false, location: 'Videollamada', attendees: ['Ana'], description: 'Revisar resultados de noviembre' },
    { id: 'demo-3', sourceId: demoSource.id, title: 'Demo de la v2 al cliente X', start: at(0, 16), end: at(0, 17), allDay: false, location: 'Sala 2', attendees: ['Ana', 'Marta', 'Luis', 'Pablo', 'Sara'], description: 'Enseñar la v2 y recoger feedback' },
    { id: 'demo-4', sourceId: demoSource.id, title: 'Planificación con finanzas', start: at(1, 11), end: at(1, 12), allDay: false, location: null, attendees: ['Luis'], description: null }
  ])
  db.markSourceSynced(demoSource.id, null)
}

/** Documento TipTap mínimo a partir de texto plano (un párrafo por línea). */
export function toDoc(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: text.split('\n').map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }))
  })
}
