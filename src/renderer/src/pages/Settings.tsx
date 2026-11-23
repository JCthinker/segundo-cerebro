import { useEffect, useState } from 'react'
import type { AiStatus, Area, Settings as S } from '@shared/types'
import { call, useAction, useData } from '../api'
import { useUpdateStatus } from '../components/UpdateBanner'
import { Button, Card, ErrorNote, Field, Icon, inputBase, inputCls, PageHeader, SectionLabel } from '../components/ui'

export function Settings({ ai, onAi }: { ai: AiStatus | null; onAi: (s: AiStatus) => void }) {
  const { data: s, reload } = useData<S & { shortcut: string | null }>('settings.get', [], ['settings'])
  const { data: areas = [] } = useData<Area[]>('areas.list', [], ['areas'])
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  useEffect(() => setModel(s?.model ?? ''), [s?.model])

  const update = useAction(async (patch: Partial<S> & { apiKey?: string | null }) => {
    await call('settings.update', patch)
    reload()
  })
  const test = useAction(async () => onAi(await call<AiStatus>('ai.test')))
  const demo = useAction(() => call('demo.load'))
  const upd = useUpdateStatus()
  const checkUpd = useAction(() => call('update.check'))
  const [newArea, setNewArea] = useState('')

  if (!s) return null
  return (
    <div className="max-w-2xl">
      <PageHeader title="Ajustes" />

      <SectionLabel>Claude</SectionLabel>
      <Card className="space-y-4 p-4">
        <div className="space-y-2">
          <label className="flex items-start gap-2.5">
            <input type="radio" className="mt-1" checked={s.aiMode === 'claude-code'} onChange={() => update.run({ aiMode: 'claude-code' })} />
            <span>
              <span className="font-medium">Tu cuenta de Claude (a través de Claude Code)</span>
              <span className="block text-[12.5px] text-muted">
                Usa la sesión de Claude Code de este ordenador. Para uso personal. Si no has iniciado sesión, abre una terminal, ejecuta <code>claude</code> y sigue los pasos.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5">
            <input type="radio" className="mt-1" checked={s.aiMode === 'api-key'} onChange={() => update.run({ aiMode: 'api-key' })} />
            <span>
              <span className="font-medium">API key de Anthropic</span>
              <span className="block text-[12.5px] text-muted">Necesaria si distribuyes la app a otras personas. Se guarda cifrada en el llavero del sistema.</span>
            </span>
          </label>
        </div>
        {s.aiMode === 'api-key' ? (
          <div className="flex gap-2">
            <input type="password" className={inputCls} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={s.hasApiKey ? 'Guardada. Escribe otra para cambiarla.' : 'sk-ant-…'} />
            <Button
              onClick={async () => {
                await update.run({ apiKey })
                setApiKey('')
              }}
              disabled={!apiKey}
            >
              Guardar
            </Button>
            {s.hasApiKey ? (
              <Button variant="ghost" onClick={() => update.run({ apiKey: null })}>
                Borrar
              </Button>
            ) : null}
          </div>
        ) : null}
        <Field label="Modelo" hint="Por defecto claude-opus-5-5.">
          <input className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} onBlur={() => model !== s.model && update.run({ model })} />
        </Field>
        <div className="flex items-center gap-3">
          <Button busy={test.busy} onClick={() => test.run()}>
            Probar conexión
          </Button>
          {ai ? (
            <span className={`text-[13px] ${ai.ok ? 'text-success' : 'text-danger'}`}>
              <Icon name={ai.ok ? 'check' : 'x'} className="mr-1 inline" />
              {ai.detail}
            </span>
          ) : (
            <span className="text-[13px] text-faint">Sin comprobar</span>
          )}
        </div>
        <label className="flex items-start gap-2.5 border-t border-line pt-3">
          <input type="checkbox" className="mt-1" checked={s.useClaudeCodeConnections} onChange={(e) => update.run({ useClaudeCodeConnections: e.target.checked })} />
          <span>
            <span className="font-medium">Usar también las conexiones de Claude Code</span>
            <span className="block text-[12.5px] text-muted">
              Las herramientas que ya tengas conectadas en Claude Code (Jira, Slack, Notion… con su inicio de sesión) estarán disponibles aquí. También se cargará tu configuración de usuario de Claude Code.
            </span>
          </span>
        </label>
      </Card>

      <SectionLabel>Brief matinal</SectionLabel>
      <Card className="p-4">
        <Field label="Preparar el brief automáticamente a las" hint="Mientras la app esté abierta. También sincroniza los calendarios cada 30 minutos.">
          <select className={`${inputBase} w-40`} value={s.briefHour} onChange={(e) => update.run({ briefHour: Number(e.target.value) })}>
            <option value={-1}>Nunca</option>
            {Array.from({ length: 13 }, (_, i) => i + 6).map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <SectionLabel>Áreas y su peso</SectionLabel>
      <Card className="p-4">
        <p className="mb-3 text-[12.5px] text-muted">El peso multiplica la prioridad: 1,5 sube un 50 % lo de esa área; 0,5 lo baja a la mitad.</p>
        {areas.map((a) => (
          <div key={a.id} className="flex items-center gap-3 py-1.5">
            <input className={`${inputCls} flex-1`} defaultValue={a.name} onBlur={(e) => e.target.value.trim() && e.target.value !== a.name && call('areas.upsert', { ...a, name: e.target.value.trim() })} />
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              defaultValue={a.weight}
              onChange={(e) => call('areas.upsert', { ...a, weight: Math.round(Number(e.target.value) * 10) / 10 })}
              className="w-36"
            />
            <span className="w-10 text-right text-[13px] tabular-nums">×{a.weight.toFixed(1).replace('.', ',')}</span>
            <Button size="sm" variant="ghost" onClick={() => call('areas.delete', a.id)} aria-label={`Quitar ${a.name}`}>
              <Icon name="trash" />
            </Button>
          </div>
        ))}
        <div className="mt-2 flex gap-2">
          <input className={inputCls} value={newArea} onChange={(e) => setNewArea(e.target.value)} placeholder="Nueva área (Salud, Cliente Y…)" />
          <Button
            disabled={!newArea.trim()}
            onClick={async () => {
              await call('areas.upsert', { name: newArea.trim(), weight: 1 })
              setNewArea('')
            }}
          >
            Añadir
          </Button>
        </div>
      </Card>

      <SectionLabel>Actualizaciones</SectionLabel>
      <Card className="space-y-3 p-4 text-[13px]">
        <p>
          Versión instalada: <strong>{upd?.current ?? '…'}</strong>. La app busca versiones nuevas cada pocas horas, las descarga sola y las instala al cerrarla o
          al reiniciar.
        </p>
        <div className="flex items-center gap-3">
          {upd?.state === 'ready' ? (
            <Button onClick={() => void call('update.install')}>Reiniciar y actualizar</Button>
          ) : (
            <Button busy={checkUpd.busy || upd?.state === 'checking' || upd?.state === 'downloading'} disabled={upd?.state === 'dev'} onClick={() => checkUpd.run()}>
              Buscar ahora
            </Button>
          )}
          {upd?.detail ? <span className={upd.state === 'error' ? 'text-danger' : 'text-muted'}>{upd.detail}</span> : null}
        </div>
      </Card>

      <SectionLabel>Otros</SectionLabel>
      <Card className="space-y-3 p-4 text-[13px]">
        <p>Captura rápida desde cualquier app: {s.shortcut ? <strong>{s.shortcut}</strong> : <span className="text-danger">no se pudo registrar el atajo</span>}</p>
        <div className="flex items-center gap-3">
          <Button busy={demo.busy} onClick={() => demo.run()}>
            Cargar datos de ejemplo
          </Button>
          <span className="text-faint">Añade una persona ficticia con notas, promesas y agenda para probar la app.</span>
        </div>
      </Card>
      <ErrorNote>{update.error || test.error || demo.error}</ErrorNote>
      <div className="h-10" />
    </div>
  )
}
