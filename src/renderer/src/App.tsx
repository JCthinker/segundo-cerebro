import { useCallback, useEffect, useState } from 'react'
import type { AiStatus, Item, Settings as S } from '@shared/types'
import { call, useData, useEvent } from './api'
import { NavContext, type Page } from './nav'
import { ApprovalHost } from './components/ApprovalHost'
import { ItemEditor } from './components/ItemEditor'
import { ChatPanel, type Incoming } from './components/ChatPanel'
import { UpdateBanner } from './components/UpdateBanner'
import { Icon } from './components/ui'
import { Onboarding } from './Onboarding'
import { Dashboard } from './pages/Dashboard'
import { Notes } from './pages/Notes'
import { History } from './pages/History'
import { Jira } from './pages/Jira'
import { WORKFLOW_NOTE_ID } from './pages/Workflow'
import { UsageMeter } from './components/UsageMeter'
import { Sources } from './pages/Sources'
import { Encargos } from './pages/Encargos'
import { InitiativeSheet } from './components/InitiativeSheet'
import { setScreenPage } from './screen'

const SCREEN_LABEL: Record<string, string> = {
  today: 'Dashboard (Hoy)',
  encargos: 'Encargos',
  jira: 'Jira',
  notes: 'Notas',
  history: 'Historial',
  settings: 'Ajustes',
  sources: 'Ajustes · Entradas'
}
import { Settings } from './pages/Settings'

const NAV: { page: Page; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { page: 'today', label: 'Dashboard', icon: 'sun' },
  { page: 'encargos', label: 'Encargos', icon: 'hand' },
  { page: 'jira', label: 'Jira', icon: 'route' },
  { page: 'notes', label: 'Notas', icon: 'notes' },
  { page: 'history', label: 'Historial', icon: 'history' }
]

/** Ajustes agrupa lo que se configura una vez: Claude, de dónde sale el contexto y tus reglas. */
const SETTINGS_TABS: { page: Page; label: string }[] = [
  { page: 'settings', label: 'General' },
  { page: 'sources', label: 'Entradas' }
]
const isSettings = (p: Page) => SETTINGS_TABS.some((t) => t.page === p)

export function App() {
  const [page, setPage] = useState<Page>('today')
  const [param, setParam] = useState<string | null>(null)
  // La conversación con Claude, en el panel de la derecha. «key» cambia al empezar una nueva.
  const [chat, setChat] = useState<{ item: Item | null; goal?: string; key: number } | null>(null)
  const [incoming, setIncoming] = useState<Incoming | null>(null)
  const newChat = (item: Item | null, goal?: string) => {
    setIncoming(null)
    setChat({ item, goal, key: Date.now() })
  }
  const [editing, setEditing] = useState<{ item: Item | null; defaults?: Partial<Item> } | null>(null)
  const [sheet, setSheet] = useState<string | null>(null)
  // Para que Claude sepa qué estás mirando cuando le hablas.
  useEffect(() => {
    setScreenPage(SCREEN_LABEL[page] ?? page)
  }, [page, param])
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
    // Mi flujo vive ahora dentro de Notas, como una página fija.
    if (p === 'workflow') {
      setPage('notes')
      setParam(WORKFLOW_NOTE_ID)
      return
    }
    setPage(p)
    setParam(prm ?? null)
  }, [])

  if (!settings) return null
  if (!settings.onboarded) return <Onboarding onDone={reloadSettings} />

  const nav = {
    page,
    param,
    go,
    resolve: newChat,
    talk: (text: string) => {
      if (!chat) setChat({ item: null, key: Date.now() })
      setIncoming({ text, n: Date.now() })
    },
    editItem: (item: Item | null, defaults?: Partial<Item>) => setEditing({ item, defaults }),
    openInitiative: (key: string) => setSheet(key)
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
                {n.page === 'today' && today?.proposedCount ? (
                  <span className="ml-auto rounded-full bg-clay px-1.5 text-[11px] font-semibold text-clay-ink">{today.proposedCount}</span>
                ) : null}
              </button>
            ))}
          </nav>
          <div className="no-drag mt-auto space-y-0.5">
            <button
              onClick={() => (chat ? setChat(null) : newChat(null))}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] ${chat ? 'bg-selected text-ink' : 'text-muted hover:bg-hover hover:text-ink'}`}
            >
              <Icon name="sparkles" className="text-clay" /> Hablar con Claude
            </button>
            <button
              onClick={() => go('settings')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] ${isSettings(page) ? 'bg-selected text-ink' : 'text-muted hover:bg-hover hover:text-ink'}`}
            >
              <Icon name="settings" /> Ajustes
            </button>
            <button onClick={() => go('settings')} className="flex w-full items-center gap-2 px-2.5 pt-2 text-left text-[11.5px] text-faint hover:text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${ai?.ok ? 'bg-success' : ai ? 'bg-danger' : 'bg-faint'}`} />
              {ai?.ok ? 'Claude conectado' : ai ? 'Claude sin conexión' : 'Comprobando Claude…'}
            </button>
            {ai?.ok && settings.aiMode === 'claude-code' ? <UsageMeter /> : null}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <UpdateBanner />
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
            {isSettings(page) ? (
              <div className="mb-6 flex gap-1 border-b border-line">
                {SETTINGS_TABS.map((t) => (
                  <button
                    key={t.page}
                    onClick={() => go(t.page)}
                    className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${page === t.page ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            ) : null}
            {page === 'today' && <Dashboard ai={ai} shortcut={settings.shortcut} />}
            {page === 'encargos' && <Encargos />}
            {page === 'jira' && <Jira />}
            {page === 'notes' && <Notes ai={ai} />}
            {page === 'history' && <History />}
            {page === 'sources' && <Sources ai={ai} />}
            {page === 'settings' && <Settings ai={ai} onAi={setAi} />}
          </div>
        </main>

        {chat ? (
          <ChatPanel
            key={chat.key}
            item={chat.item}
            initialGoal={chat.goal}
            incoming={incoming}
            onClose={() => setChat(null)}
            onNew={() => newChat(null)}
          />
        ) : null}
      </div>


      {sheet ? <InitiativeSheet jiraKey={sheet} onClose={() => setSheet(null)} /> : null}
      {editing ? <ItemEditor item={editing.item} defaults={editing.defaults} onClose={() => setEditing(null)} /> : null}
      <ApprovalHost />
    </NavContext.Provider>
  )
}
