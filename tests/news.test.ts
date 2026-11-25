import { describe, expect, it } from 'vitest'
import { acceptNews, rememberSeen, type NewsEntry } from '../src/shared/news'

const n = (p: Partial<NewsEntry>): NewsEntry => ({
  id: 'x', at: '2026-11-24T10:00:00Z', ref: 'slack:1', tool: 'Slack', from: 'Ana', summary: 'Algo', action: 'encargo', target: null, title: 'Algo', why: '', ...p
})

describe('novedades', () => {
  it('no deja pasar ruido, repetidos ni lo ya visto', () => {
    const got = acceptNews([n({ ref: 'a' }), n({ ref: 'a' }), n({ ref: 'b', action: 'noise' }), n({ ref: 'c' }), n({ ref: 'd' })], [n({ ref: 'd' })], ['c'])
    expect(got.map((x) => x.ref)).toEqual(['a'])
  })
  it('recuerda lo leído con un límite', () => {
    expect(rememberSeen(['a', 'b'], ['c', 'a', ' '], 3)).toEqual(['c', 'a', 'b'])
  })
})

describe('explainNewsPrompt', () => {
  it('incluye lo que se sabe y pide no escribir nada', async () => {
    const { explainNewsPrompt } = await import('../src/shared/news')
    const p = explainNewsPrompt({
      id: '1', at: '', ref: 'https://slack.com/x', tool: 'Slack', from: 'Ana', summary: 'Ana pide el informe',
      action: 'encargo', target: null, title: 'Informe', why: 'te lo pide a ti', context: 'Lo necesita el viernes.', quote: '¿me pasas el informe?'
    })
    expect(p).toContain('de Ana')
    expect(p).toContain('Lo necesita el viernes.')
    expect(p).toContain('«¿me pasas el informe?»')
    expect(p).toContain('No escribas ni envíes nada')
  })
})
