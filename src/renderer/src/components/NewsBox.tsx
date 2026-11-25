import { useState } from 'react'
import type { JiraSnapshot } from '@shared/jira'
import { readAgo } from '@shared/jira'
import { explainNewsPrompt, type NewsEntry, type NewsTarget } from '@shared/news'
import type { ScoredItem } from '@shared/types'
import { call, useAction, useData } from '../api'
import { useNav } from '../nav'
import { Button, Card, ErrorNote, Icon, inputCls, SectionLabel } from './ui'

interface NewsView {
  pending: NewsEntry[]
  running: boolean
  last: string | null
}

/** Novedades: lo nuevo de tus herramientas, con lo que Claude propone hacer. Tú decides. */
export function NewsBox({ items }: { items: ScoredItem[] }) {
  const { data } = useData<NewsView>('news.get', [], ['news'])
  const { data: jira } = useData<{ snapshot: JiraSnapshot | null }>('jira.get', [], ['jira'])
  const review = useAction(() => call('news.review'))
  const [all, setAll] = useState(false)
  if (!data) return null
  const busy = data.running || review.busy
  const targets: NewsTarget[] = [
    ...(jira?.snapshot?.initiatives.filter((i) => !/done/i.test(i.status)).map((i) => ({ kind: 'road' as const, id: i.key, title: i.title })) ?? []),
    ...items.map((s) => ({ kind: 'item' as const, id: s.item.id, title: s.item.title }))
  ]
  const shown = all ? data.pending : data.pending.slice(0, 4)

  return (
    <>
      <SectionLabel
        right={
          <span className="flex items-center gap-2 text-[12px] text-faint">
            {data.last ? `Leído ${readAgo(data.last, new Date())}` : null}
            <Button size="sm" variant="ghost" busy={busy} onClick={() => void review.run()}>
              {!busy ? <Icon name="refresh" /> : null} {busy ? 'Leyendo…' : 'Repasar ahora'}
            </Button>
          </span>
        }
      >
        Novedades{data.pending.length ? ` (${data.pending.length})` : ''}
      </SectionLabel>
      <ErrorNote>{review.error}</ErrorNote>
      {data.pending.length ? (
        <Card className="px-4">
          {shown.map((n) => (
            <NewsRow key={n.id} n={n} targets={targets} />
          ))}
          {data.pending.length > 4 ? (
            <button className="w-full py-2.5 text-[12.5px] text-muted hover:text-ink" onClick={() => setAll(!all)}>
              {all ? 'Ver menos' : `Ver ${data.pending.length - 4} más`}
            </button>
          ) : null}
        </Card>
      ) : (
        <Card className="px-4 py-4 text-center text-[13px] text-faint">
          {busy ? 'Claude está leyendo lo nuevo de tus herramientas…' : 'Nada nuevo que repasar. Claude vuelve a mirar cada 2 horas.'}
        </Card>
      )}
    </>
  )
}

function NewsRow({ n, targets }: { n: NewsEntry; targets: NewsTarget[] }) {
  const { talk } = useNav()
  const [mode, setMode] = useState<null | 'other' | 'dismiss'>(null)
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState('')
  const [reason, setReason] = useState('')
  const decide = useAction(async (d: unknown) => {
    const r = await call<{ talk: string | null }>('news.decide', n.id, d)
    if (r.talk) talk(r.talk)
  })

  const proposal =
    n.action === 'add' && n.target
      ? { text: `Añadir a ${n.target.kind === 'road' ? `${n.target.id} ` : ''}«${n.target.title}»`, button: 'Añadir' }
      : n.action === 'product'
        ? { text: `Para producto: «${n.title}»`, button: 'Llevar a producto' }
        : { text: `Nuevo encargo: «${n.title}»`, button: 'Crear encargo' }

  return (
    <div className="border-b border-line py-3 last:border-0">
      <button className="flex w-full items-start gap-1.5 text-left" onClick={() => setOpen(!open)} title={open ? 'Cerrar' : 'Ver el contexto'}>
        <Icon name="chevron" className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="text-[13.5px] hover:underline">{n.summary}</span>
      </button>
      <div className="mt-0.5 pl-5 text-[12px] text-faint">
        {[n.from, n.tool].filter(Boolean).join(' · ')}
        {n.ref.startsWith('http') ? (
          <button className="ml-2 hover:text-ink hover:underline" onClick={() => call('shell.open', n.ref)}>
            Ver el original ↗
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="mt-2 ml-5 space-y-2 rounded-lg bg-panel px-3 py-2.5 text-[13px] leading-relaxed">
          {n.context ? <p className="whitespace-pre-wrap">{n.context}</p> : null}
          {n.quote ? <blockquote className="border-l-2 border-line-strong pl-2.5 whitespace-pre-wrap text-muted italic">«{n.quote}»</blockquote> : null}
          {n.why ? (
            <p>
              <span className="font-medium">Por qué Claude propone esto:</span> <span className="text-muted">{n.why}</span>
            </p>
          ) : null}
          {!n.context && !n.quote ? <p className="text-faint">Esta novedad se leyó antes de que Claude guardara más contexto. Pregúntale y te lo explica.</p> : null}
          <Button size="sm" variant="ghost" onClick={() => talk(explainNewsPrompt(n))}>
            <Icon name="chat" /> Pregúntale a Claude
          </Button>
        </div>
      ) : null}
      <div className="mt-1.5 flex items-start gap-1.5 text-[12.5px]">
        <Icon name="sparkles" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-clay" />
        <span>
          <span className="font-medium">{proposal.text}</span>
          {n.why && !open ? <span className="text-muted"> · {n.why}</span> : null}
        </span>
      </div>
      {mode === 'other' ? (
        <div className="mt-2 flex gap-2">
          <select className={inputCls} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">¿A qué lo añado?</option>
            {targets.map((t) => (
              <option key={`${t.kind}:${t.id}`} value={`${t.kind}:${t.id}`}>
                {t.kind === 'road' ? `${t.id} · ` : ''}
                {t.title}
              </option>
            ))}
          </select>
          <Button size="sm" variant="primary" disabled={!pick} busy={decide.busy} onClick={() => decide.run({ how: 'retarget', target: targets.find((t) => `${t.kind}:${t.id}` === pick) })}>
            Añadir
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
            Cancelar
          </Button>
        </div>
      ) : mode === 'dismiss' ? (
        <div className="mt-2 flex gap-2">
          <input autoFocus className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="¿Por qué? (opcional, Claude aprende de esto)" onKeyDown={(e) => e.key === 'Enter' && decide.run({ how: 'dismiss', reason })} />
          <Button size="sm" variant="primary" busy={decide.busy} onClick={() => decide.run({ how: 'dismiss', reason })}>
            Descartar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" busy={decide.busy} onClick={() => decide.run({ how: 'accept' })}>
            <Icon name="check" /> {proposal.button}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('other')}>
            A otra
          </Button>
          {n.action !== 'encargo' ? (
            <Button size="sm" variant="ghost" onClick={() => decide.run({ how: 'asEncargo' })}>
              Es un encargo
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setMode('dismiss')}>
            Descartar
          </Button>
        </div>
      )}
      <ErrorNote>{decide.error}</ErrorNote>
    </div>
  )
}
