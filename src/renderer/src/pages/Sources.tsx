import { useState } from 'react'
import type { ActionRun, AiStatus, ClaudeConnector, McpServer, McpServerConfigJson, Settings, Source } from '@shared/types'
import { call, useAction, useData } from '../api'
import { Button, Card, Empty, ErrorNote, Field, Icon, inputCls, Modal, PageHeader, Pill, SectionLabel, Spinner, textareaCls } from '../components/ui'
import { useNav } from '../nav'

/** Plantillas para conectar herramientas. Son un punto de partida: revisa la documentación de cada proveedor. */
const CATALOG: { name: string; label: string; icon: Parameters<typeof Icon>[0]['name']; config: McpServerConfigJson; note: string; pull: string }[] = [
  {
    name: 'jira',
    label: 'Jira / Confluence',
    icon: 'flag',
    config: { type: 'http', url: 'https://mcp.atlassian.com/v1/mcp' },
    note: 'Servidor oficial de Atlassian. Usa OAuth: lo más fácil es conectarlo en Claude Code y activar «Usar las conexiones de Claude Code» en Ajustes.',
    pull: 'Tickets asignados a mí o donde me mencionan, actualizados en los últimos 3 días'
  },
  {
    name: 'slack',
    label: 'Slack',
    icon: 'chat',
    config: { type: 'http', url: 'https://mcp.slack.com/mcp' },
    note: 'Servidor oficial de Slack (OAuth). Conéctalo en Claude Code o pon aquí la URL y cabeceras que te dé tu administrador.',
    pull: 'Mensajes de los últimos 2 días donde me mencionan o me piden algo, y lo que yo he prometido'
  },
  {
    name: 'github',
    label: 'GitHub',
    icon: 'tool',
    config: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer TU_TOKEN' } },
    note: 'Crea un token personal en GitHub (Settings → Developer settings) y sustituye TU_TOKEN.',
    pull: 'Issues y pull requests asignados a mí o donde se me pide revisión'
  },
  {
    name: 'notion',
    label: 'Notion',
    icon: 'notes',
    config: { type: 'http', url: 'https://mcp.notion.com/mcp' },
    note: 'Servidor oficial de Notion (OAuth). Conéctalo en Claude Code y activa «Usar las conexiones de Claude Code».',
    pull: 'Tareas asignadas a mí con fecha en las próximas 2 semanas'
  },
  {
    name: 'linear',
    label: 'Linear',
    icon: 'route',
    config: { type: 'http', url: 'https://mcp.linear.app/mcp' },
    note: 'Servidor oficial de Linear (OAuth).',
    pull: 'Issues asignados a mí en el ciclo actual'
  }
]

/** Qué leer por defecto y qué regla de permisos proponer para cada conexión de la cuenta de Claude. */
const CONNECTOR_HINTS: Record<string, { pull: string; rule?: string }> = {
  Gmail: {
    pull: 'Correos de los últimos 3 días donde me piden algo, me ponen una fecha o yo prometo algo. Ignora newsletters, notificaciones automáticas y promociones.',
    rule: 'gmail: solo borrador'
  },
  'Google Drive': { pull: 'Documentos compartidos conmigo o con comentarios para mí en los últimos 3 días donde me piden algo' },
  Notion: { pull: 'Tareas asignadas a mí con fecha en las próximas 2 semanas' },
  'Google Calendar': { pull: 'Reuniones de los próximos 7 días donde tengo que preparar o enviar algo' }
}

export function Sources({ ai }: { ai: AiStatus | null }) {
  const { go } = useNav()
  const { data: sources = [] } = useData<Source[]>('sources.list', [], ['sources', 'events'])
  const { data: servers = [] } = useData<McpServer[]>('mcp.list', [], ['mcp'])
  const { data: runs = [] } = useData<ActionRun[]>('runs.list', [], ['items'])
  const [editing, setEditing] = useState<Partial<McpServer> | null>(null)
  const [pullFor, setPullFor] = useState<Partial<Source> | null>(null)
  const [icsUrl, setIcsUrl] = useState('')
  const addIcs = useAction(async () => {
    if (!/^(https?|webcal):\/\//i.test(icsUrl.trim()) && !icsUrl.trim().startsWith('/')) throw new Error('Pega la URL del calendario (https:// o webcal://).')
    await call('sources.upsert', { kind: 'ics', name: 'Calendario', config: { url: icsUrl.trim() }, enabled: true })
    setIcsUrl('')
  })
  const sync = useAction((id: string) => call<number>('sources.sync', id))
  const fromFile = useAction(() => call<number | null>('file.import'))

  const calendars = sources.filter((s) => s.kind === 'ics')
  const pulls = sources.filter((s) => s.kind === 'mcp')

  return (
    <div>
      <PageHeader title="Entradas" subtitle="Todo lo que entra se convierte en cosas por hacer. Tú confirmas cada una en «Nuevo detectado»." />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <Tile icon="notes" title="Notas" sub="Integrado. Se analizan solas mientras escribes." onClick={() => go('notes')} />
        <Tile icon="bolt" title="Captura rápida" sub="Atajo global o la caja del dashboard." onClick={() => go('today')} />
        <Tile icon="users" title="Actas de reunión" sub="Pégala en la caja del dashboard." onClick={() => go('today')} />
        <Tile icon="file" title="Archivos y PDFs" sub={fromFile.busy ? 'Analizando…' : 'Elige un archivo para analizar.'} onClick={() => fromFile.run()} />
        <Tile icon="calendar" title="Calendario" sub={calendars.length ? `${calendars.length} conectado${calendars.length > 1 ? 's' : ''}` : 'Conecta con una URL de calendario (ICS).'} />
        <Tile icon="mic" title="Notas de voz" sub="Próximamente." muted />
      </div>
      <ErrorNote>{fromFile.error}</ErrorNote>

      <SectionLabel>Calendarios</SectionLabel>
      <Card className="p-4">
        {calendars.map((c) => (
          <div key={c.id} className="flex items-center gap-2 border-b border-line py-2 last:mb-2">
            <Icon name="calendar" className="text-muted" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]">{c.config.demo ? 'Calendario de ejemplo' : String(c.config.url)}</div>
              <div className="text-[12px] text-faint">
                {c.lastError ? <span className="text-danger">{c.lastError}</span> : c.lastSync ? `Sincronizado ${new Date(c.lastSync).toLocaleString('es-ES', { timeStyle: 'short', dateStyle: 'short' })}` : 'Sin sincronizar'}
              </div>
            </div>
            {!c.config.demo ? (
              <Button size="sm" variant="ghost" busy={sync.busy} onClick={() => sync.run(c.id)}>
                <Icon name="refresh" />
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => call('sources.delete', c.id)} aria-label="Quitar">
              <Icon name="trash" />
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <input className={inputCls} value={icsUrl} onChange={(e) => setIcsUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" />
          <Button busy={addIcs.busy} onClick={() => addIcs.run()}>
            Conectar
          </Button>
        </div>
        <p className="mt-2 text-[12px] text-faint">
          Google Calendar: Configuración → tu calendario → «Dirección secreta en formato iCal». Outlook: Calendario → Compartir → Publicar → ICS. iCloud: compartir calendario como público.
        </p>
        <ErrorNote>{addIcs.error || sync.error}</ErrorNote>
      </Card>

      <ClaudeConnectors onPull={setPullFor} />

      <SectionLabel right={<Button size="sm" variant="ghost" onClick={() => setEditing({ name: '', config: { type: 'http', url: '' }, enabled: true })}><Icon name="plus" /> Personalizada</Button>}>
        Herramientas (MCP): Claude las usa para leer y para resolver
      </SectionLabel>
      <Card className="px-4">
        {servers.map((s) => (
          <div key={s.id} className="flex items-center gap-2 border-b border-line py-2.5 last:border-0">
            <Icon name="plug" className={s.enabled ? 'text-success' : 'text-faint'} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{s.name}</div>
              <div className="truncate text-[12px] text-faint">{'url' in s.config ? s.config.url : `${s.config.command} ${(s.config.args ?? []).join(' ')}`}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setPullFor({ kind: 'mcp', name: `Desde ${s.name}`, config: { server: s.name, instructions: CATALOG.find((c) => c.name === s.name)?.pull ?? '' }, enabled: true })}>
              Traer al dashboard
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
              Editar
            </Button>
          </div>
        ))}
        {!servers.length ? <p className="py-3 text-[13px] text-muted">Ninguna conectada todavía. Empieza con una plantilla:</p> : null}
        <div className="flex flex-wrap gap-2 pb-3">
          {CATALOG.filter((c) => !servers.some((s) => s.name === c.name)).map((c) => (
            <Button key={c.name} size="sm" onClick={() => setEditing({ name: c.name, config: c.config, enabled: true })}>
              <Icon name={c.icon} /> {c.label}
            </Button>
          ))}
        </div>
      </Card>

      {pulls.length ? (
        <>
          <SectionLabel>Lecturas programadas</SectionLabel>
          <Card className="px-4">
            {pulls.map((p) => (
              <div key={p.id} className="flex items-center gap-2 border-b border-line py-2.5 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{p.name}</div>
                  <div className="truncate text-[12px] text-faint">
                    {String(p.config.instructions)} ·{' '}
                    {p.lastError ? <span className="text-danger">{p.lastError}</span> : p.lastSync ? `última vez ${new Date(p.lastSync).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}` : 'nunca'}
                  </div>
                </div>
                <Button size="sm" variant="claude" busy={sync.busy} disabled={ai?.ok === false} onClick={() => sync.run(p.id)}>
                  Traer ahora
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPullFor(p)}>
                  Editar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => call('sources.delete', p.id)} aria-label="Quitar">
                  <Icon name="trash" />
                </Button>
              </div>
            ))}
          </Card>
        </>
      ) : null}

      <SectionLabel>Registro de lo que ha hecho Claude</SectionLabel>
      {runs.length ? (
        <Card className="px-4">
          {runs.map((r) => (
            <div key={r.id} className="flex items-center gap-2 border-b border-line py-2 text-[13px] last:border-0">
              <span className="w-28 shrink-0 text-[12px] text-faint">{new Date(r.createdAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</span>
              <span className="min-w-0 flex-1 truncate">{r.goal}</span>
              <span className="text-[12px] text-faint">
                {r.log.filter((e) => e.type === 'approved').length} aprobadas · {r.log.filter((e) => e.type === 'draft').length} borradores
              </span>
              {r.mode === 'drafts' ? <Pill>Solo borradores</Pill> : null}
              <Pill tone={r.status === 'done' ? 'success' : r.status === 'error' ? 'danger' : 'neutral'}>{r.status === 'done' ? 'Hecho' : r.status === 'error' ? 'Error' : r.status === 'running' ? 'En curso' : 'Cancelado'}</Pill>
            </div>
          ))}
        </Card>
      ) : (
        <Empty title="Todavía no has pedido a Claude que resuelva nada">Pulsa «Resolver» en cualquier promesa o tarea.</Empty>
      )}

      {editing ? <McpEditor server={editing} onClose={() => setEditing(null)} /> : null}
      {pullFor ? <PullEditor source={pullFor} onClose={() => setPullFor(null)} /> : null}
    </div>
  )
}

function ClaudeConnectors({ onPull }: { onPull: (s: Partial<Source>) => void }) {
  const { data: settings } = useData<Settings>('settings.get', [], ['mcp'])
  const { data: list, error, reload } = useData<ClaudeConnector[]>('connectors.list', [], ['mcp'])
  const [suggestRule, setSuggestRule] = useState<string | null>(null)
  const refresh = useAction(async () => {
    await call('connectors.list', true)
    reload()
  })
  const toggle = useAction(async (c: ClaudeConnector) => {
    const r = await call<{ hasRule: boolean }>('connectors.toggle', c.name, !c.enabled)
    const rule = CONNECTOR_HINTS[c.label]?.rule
    setSuggestRule(!c.enabled && !r.hasRule && rule ? rule : null)
  })
  const [calMsg, setCalMsg] = useState<string | null>(null)
  const syncCal = useAction(async () => {
    setCalMsg(null)
    const n = await call<number>('connectors.syncCalendars')
    setCalMsg(n ? `Listo: ${n} ${n === 1 ? 'evento' : 'eventos'} en tu calendario de las próximas dos semanas.` : 'Conectado, pero no hay eventos en las próximas dos semanas.')
  })
  const addRule = useAction(async (rule: string) => {
    await call('workflow.appendRule', 'Permisos', rule)
    setSuggestRule(null)
  })
  if (settings?.aiMode === 'api-key') return null

  return (
    <>
      <SectionLabel
        right={
          <Button size="sm" variant="ghost" busy={refresh.busy} onClick={() => refresh.run()}>
            <Icon name="refresh" /> Volver a buscar
          </Button>
        }
      >
        De tu cuenta de Claude
      </SectionLabel>
      <Card className="px-4">
        <p className="pt-3 text-[12.5px] text-muted">
          Las conexiones que tienes en claude.ai (Ajustes → Conectores). La app puede usarlas todas, siempre con los permisos de Mi flujo. Desmarca las que no quieras.
        </p>
        {!list && !error ? (
          <div className="flex items-center gap-2 py-3 text-[13px] text-muted">
            <Spinner /> Buscando tus conexiones…
          </div>
        ) : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {list && !list.length ? <p className="py-3 text-[13px] text-muted">No hay conexiones en tu cuenta. Añádelas en claude.ai → Ajustes → Conectores.</p> : null}
        <div className="pt-1">
          {list?.map((c) => {
            const ok = c.status === 'connected'
            return (
              <div key={c.name} className="flex items-center gap-2 border-b border-line py-2.5 last:border-0">
                <Icon name="plug" className={c.enabled && ok ? 'text-success' : 'text-faint'} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{c.label}</div>
                  <div className="text-[12px] text-faint">
                    {ok ? `${c.tools} herramientas` : c.status === 'needs-auth' ? 'Hay que volver a iniciar sesión en claude.ai → Ajustes → Conectores' : 'No responde ahora mismo'}
                  </div>
                </div>
                {c.enabled && ok && /calendar|calendario/i.test(c.label) ? (
                  <Button size="sm" variant="ghost" busy={syncCal.busy} onClick={() => syncCal.run()}>
                    <Icon name="refresh" /> Traer reuniones
                  </Button>
                ) : null}
                {c.enabled && ok ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onPull({ kind: 'mcp', name: `Desde ${c.label}`, config: { server: c.name, instructions: CONNECTOR_HINTS[c.label]?.pull ?? 'Lo que me afecte de los últimos 3 días' }, enabled: true })}
                  >
                    Traer al dashboard
                  </Button>
                ) : null}
                <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
                  <input type="checkbox" checked={c.enabled} disabled={toggle.busy || (!ok && !c.enabled)} onChange={() => toggle.run(c)} /> Usar en la app
                </label>
              </div>
            )
          })}
        </div>
        {suggestRule ? (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-info-bg p-3 text-[12.5px] text-accent">
            <span className="flex-1">
              Para empezar con calma: ¿añado a Mi flujo la regla <code>{suggestRule}</code>? Claude preparará borradores pero no enviará nada.
            </span>
            <Button size="sm" busy={addRule.busy} onClick={() => addRule.run(suggestRule)}>
              Añadir regla
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSuggestRule(null)}>
              No
            </Button>
          </div>
        ) : null}
        {calMsg ? <p className="pb-3 text-[12.5px] text-success">{calMsg}</p> : null}
        <ErrorNote>{toggle.error || refresh.error || addRule.error || syncCal.error}</ErrorNote>
      </Card>
    </>
  )
}

function Tile({ icon, title, sub, onClick, muted }: { icon: Parameters<typeof Icon>[0]['name']; title: string; sub: string; onClick?: () => void; muted?: boolean }) {
  return (
    <button disabled={!onClick} onClick={onClick} className={`rounded-xl border border-line bg-raised p-3 text-left ${onClick ? 'hover:border-line-strong' : ''} ${muted ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 font-medium">
        <Icon name={icon} className="text-muted" /> {title}
      </div>
      <div className="mt-0.5 text-[12px] text-faint">{sub}</div>
    </button>
  )
}

function McpEditor({ server, onClose }: { server: Partial<McpServer>; onClose: () => void }) {
  const [name, setName] = useState(server.name ?? '')
  const [json, setJson] = useState(JSON.stringify(server.config ?? { type: 'http', url: '' }, null, 2))
  const [enabled, setEnabled] = useState(server.enabled ?? true)
  const note = CATALOG.find((c) => c.name === server.name)?.note
  const save = useAction(async () => {
    let config: McpServerConfigJson
    try {
      config = JSON.parse(json)
    } catch {
      throw new Error('La configuración no es JSON válido.')
    }
    await call('mcp.upsert', { id: server.id, name: name.trim(), config, enabled })
    onClose()
  })
  return (
    <Modal onClose={onClose}>
      <div className="space-y-3 p-5">
        <h2 className="text-[16px] font-semibold">{server.id ? 'Editar herramienta' : 'Conectar herramienta'}</h2>
        {note ? <p className="rounded-lg bg-info-bg p-3 text-[12.5px] text-accent">{note}</p> : null}
        <Field label="Nombre" hint="Aparece en Mi flujo › Permisos (por ejemplo «- slack: requiere OK»).">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="slack" />
        </Field>
        <Field label="Configuración MCP" hint='HTTP: {"type":"http","url":"…","headers":{…}} · Local: {"command":"npx","args":[…],"env":{…}}. Se guarda cifrada.'>
          <textarea rows={8} className={`${textareaCls} font-mono text-[12.5px]`} value={json} onChange={(e) => setJson(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Activa
        </label>
        <ErrorNote>{save.error}</ErrorNote>
        <div className="flex gap-2 pt-2">
          {server.id ? (
            <Button
              variant="danger"
              onClick={async () => {
                await call('mcp.delete', server.id)
                onClose()
              }}
            >
              Quitar
            </Button>
          ) : null}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" busy={save.busy} onClick={() => save.run()}>
              Guardar
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function PullEditor({ source, onClose }: { source: Partial<Source>; onClose: () => void }) {
  const [instructions, setInstructions] = useState(String(source.config?.instructions ?? ''))
  const save = useAction(async () => {
    await call('sources.upsert', { ...source, config: { ...source.config, instructions } })
    onClose()
  })
  return (
    <Modal onClose={onClose}>
      <div className="space-y-3 p-5">
        <h2 className="text-[16px] font-semibold">Traer al dashboard desde {String(source.config?.server).replace(/^claude\.ai\s+/i, '')}</h2>
        <p className="text-[13px] text-muted">Claude usará solo herramientas de lectura y dejará lo que encuentre en «Nuevo detectado» para que lo confirmes.</p>
        <Field label="Qué buscar">
          <textarea rows={3} className={textareaCls} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </Field>
        <ErrorNote>{save.error}</ErrorNote>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" busy={save.busy} onClick={() => save.run()}>
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
