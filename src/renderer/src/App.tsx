import { useCallback, useEffect, useState } from 'react'
import type { AiStatus, Item, Settings as S } from '@shared/types'
import { call, useData, useEvent } from './api'
import { NavContext, type Page } from './nav'
import { ApprovalHost } from './components/ApprovalHost'
import { ItemEditor } from './components/ItemEditor'
import { ResolvePanel } from './components/ResolvePanel'
import { Icon } from './components/ui'
import { Onboarding } from './Onboarding'
import { Today } from './pages/Today'
import { Inbox } from './pages/Inbox'
import { Notes } from './pages/Notes'
import { Commitments } from './pages/Commitments'
import { Workflow } from './pages/Workflow'
import { Sources } from './pages/Sources'
import { Ask } from './pages/Ask'
import { Settings } from './pages/Settings'

const NAV: { page: Page; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { page: 'today', label: 'Hoy', icon: 'sun' },
  { page: 'inbox', label: 'Bandeja', icon: 'inbox' },
  { page: 'notes', label: 'Notas', icon: 'notes' },
  { page: 'promises', label: 'Promesas', icon: 'hand' },
  { page: 'deadlines', label: 'Entregas', icon: 'flag' },
  { page: 'workflow', label: 'Mi flujo', icon: 'route' },
  { page: 'sources', label: 'Entradas', icon: 'plug' },
  { page: 'ask', label: 'Preguntar', icon: 'chat' }
]

export function App() {
  const [page, setPage] = useState<Page>('today')
  const [param, setParam] = useState<string | null>(null)
  const [resolving, setResolving] = useState<{ item: Item | null; goal?: string } | null>(null)
  const [editing, setEditing] = useState<{ item: Item | null; defaults?: Partial<Item> } | null>(null)
  const [ai, setAi] = useState<AiStatus | null>(null)
  const { data: settings, reload: reloadSettings } = useData<S & { shortcut: string | null }>('settings.get', [], ['settings'])
  const { data: today } = useData<{ proposedCount: number }>('today.get', [], ['items'])

  const refreshAi = useCallback(() => void call<AiStatus | null>('ai.status').then(setAi), [])
  useEffect(() => {
    refreshAi()
    const t = setInterval(refreshAi, 15_000)
    return () => clearInterval(t)
  }, [refreshAi])
  useEvent('data-changed', refreshAi)

  // Primera comprobación de la IA, en segundo plano, cuando la app ya está configurada.
  useEffect(() => {
    if (settings?.onboarded && ai === null) void call<AiStatus>('ai.test').then(setAi)
  }, [settings?.onboarded, ai])

  const go = useCallback((p: Page, prm?: string) => {
    setPage(p)
    setParam(prm ?? null)
  }, [])

  if (!settings) return null
  if (!settings.onboarded) return <Onboarding onDone={reloadSettings} />

  const nav = {
    page,
    param,
    go,
    resolve: (item: Item | null, goal?: string) => setResolving({ item, goal }),
    editItem: (item: Item | null, defaults?: Partial<Item>) => setEditing({ item, defaults })
  }

  return (
    <NavContext.Provider value={nav}>
      <div className="flex h-full">
        <aside className="drag flex w-52 shrink-0 flex-col border-r border-line bg-panel px-2.5 pt-11 pb-3">
          <nav className="no-drag space-y-0.5">
            {NAV.map((n) => (
              <button
                key={n.page}
                onClick={() => go(n.page)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] ${
                  page === n.page ? 'bg-selected font-medium text-ink' : 'text-muted hover:bg-hover hover:text-ink'
                }`}
              >
                <Icon name={n.icon} />
                {n.label}
                {n.page === 'inbox' && today?.proposedCount ? (
                  <span className="ml-auto rounded-full bg-clay px-1.5 text-[11px] font-semibold text-clay-ink">{today.proposedCount}</span>
                ) : null}
              </button>
            ))}
          </nav>
          <div className="no-drag mt-auto space-y-0.5">
            <button
              onClick={() => setResolving({ item: null })}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] text-muted hover:bg-hover hover:text-ink"
            >
              <Icon name="sparkles" className="text-clay" /> Pedir algo a Claude
            </button>
            <button
              onClick={() => go('settings')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] ${page === 'settings' ? 'bg-selected text-ink' : 'text-muted hover:bg-hover hover:text-ink'}`}
            >
              <Icon name="settings" /> Ajustes
            </button>
            <button onClick={() => go('settings')} className="flex w-full items-center gap-2 px-2.5 pt-2 text-left text-[11.5px] text-faint hover:text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${ai?.ok ? 'bg-success' : ai ? 'bg-danger' : 'bg-faint'}`} />
              {ai?.ok ? 'Claude conectado' : ai ? 'Claude sin conexión' : 'Comprobando Claude…'}
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          {ai && !ai.ok && page !== 'settings' ? (
            <div className="flex items-center gap-2 border-b border-line bg-warning-bg px-8 py-2 text-[12.5px] text-warning">
              <Icon name="sparkles" />
              <span className="flex-1">{ai.detail} La app funciona igual, pero sin detectar elementos ni resolver con Claude.</span>
              <button className="font-medium underline" onClick={() => go('settings')}>
                Ajustes
              </button>
            </div>
          ) : null}
          <div className={page === 'notes' ? 'h-full px-8 py-6' : 'mx-auto max-w-5xl px-8 pt-10 pb-6'}>
            {page === 'today' && <Today ai={ai} />}
            {page === 'inbox' && <Inbox shortcut={settings.shortcut} />}
            {page === 'notes' && <Notes ai={ai} />}
            {page === 'promises' && <Commitments kind="promise" />}
            {page === 'deadlines' && <Commitments kind="deadline" />}
            {page === 'workflow' && <Workflow ai={ai} />}
            {page === 'sources' && <Sources ai={ai} />}
            {page === 'ask' && <Ask ai={ai} />}
            {page === 'settings' && <Settings ai={ai} onAi={setAi} />}
          </div>
        </main>
      </div>

      {resolving ? <ResolvePanel item={resolving.item} initialGoal={resolving.goal} onClose={() => setResolving(null)} /> : null}
      {editing ? <ItemEditor item={editing.item} defaults={editing.defaults} onClose={() => setEditing(null)} /> : null}
      <ApprovalHost />
    </NavContext.Provider>
  )
}
