import { useState } from 'react'
import { parseDay } from '@shared/dates'
import type { MeasureRow } from '@shared/measure'
import { call, useAction, useData } from '../api'
import { useNav } from '../nav'
import { Button, Card, ErrorNote, Icon, inputCls, Pill } from './ui'

const day = (d: string) => parseDay(d).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })

/** Mediciones: lo lanzado, cuándo medir su KPI y la conclusión registrada en ROAD. */
export function MeasureTab() {
  const { data: rows } = useData<MeasureRow[]>('measure.list', [], ['jira'])
  const plan = useAction(() => call('measure.plan'))
  if (!rows) return null
  const pendingAI = rows.some((r) => !r.result && !r.plan.byAI)
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <p className="flex-1 text-[13px] text-muted">
          Las iniciativas terminadas en los últimos 4 meses. Claude lee el KPI de cada una y decide cuándo tiene sentido medir; cuando toca, aparece en tu flujo de producto.
        </p>
        {pendingAI ? (
          <Button size="sm" variant="claude" busy={plan.busy} onClick={() => void plan.run()}>
            <Icon name="sparkles" /> Que Claude decida las fechas
          </Button>
        ) : null}
      </div>
      <ErrorNote>{plan.error}</ErrorNote>
      {rows.length ? rows.map((r) => <MeasureCard key={r.key} r={r} />) : <p className="py-6 text-center text-[13px] text-muted">No hay iniciativas terminadas recientemente.</p>}
    </div>
  )
}

function MeasureCard({ r }: { r: MeasureRow }) {
  const { talk } = useNav()
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState('')
  const record = useAction(async () => {
    talk(await call<string>('measure.record', r.key, text))
    setWriting(false)
  })
  return (
    <Card className="mb-3 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button className="text-left hover:underline" onClick={() => r.url && call('shell.open', r.url)}>
            <span className="mr-2 text-[12px] text-faint">{r.key}</span>
            <span className="font-medium">{r.title}</span>
          </button>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {r.plan.kpi ? <>KPI: {r.plan.kpi} · </> : null}
            {r.doneOn ? `Terminada el ${day(r.doneOn)}` : 'Terminada'}
          </div>
          {r.result ? (
            <p className="mt-1.5 text-[13px]">
              <span className="text-success">Medido:</span> {r.result.text}
            </p>
          ) : (
            <p className="mt-1.5 text-[12.5px]">
              Medir el <span className="font-medium">{day(r.plan.date)}</span>
              <span className="text-faint"> · {r.plan.why}</span>
            </p>
          )}
        </div>
        {r.result ? <Pill tone="success">Medido</Pill> : r.due ? <Pill tone="warning">Toca medir</Pill> : <Pill>Pendiente</Pill>}
      </div>
      {!r.result && !writing ? (
        <div className="mt-2 flex gap-1.5">
          <Button
            size="sm"
            variant="claude"
            onClick={() =>
              talk(`Ayúdame a medir ${r.key} «${r.title}»${r.plan.kpi ? `: su KPI es «${r.plan.kpi}»` : ''}. Busca en mis herramientas los datos o el panel donde se ve y dime cómo ha ido desde que se lanzó${r.doneOn ? ` (${r.doneOn})` : ''}.`)
            }
          >
            <Icon name="sparkles" /> Medir con Claude
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWriting(true)}>
            Registrar resultado
          </Button>
        </div>
      ) : null}
      {writing ? (
        <div className="mt-2 flex gap-2">
          <input autoFocus className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="¿Qué ha pasado con el KPI? Claude lo dejará como conclusión en ROAD" />
          <Button size="sm" variant="primary" disabled={!text.trim()} busy={record.busy} onClick={() => record.run()}>
            Guardar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWriting(false)}>
            Cancelar
          </Button>
        </div>
      ) : null}
      <ErrorNote>{record.error}</ErrorNote>
    </Card>
  )
}
