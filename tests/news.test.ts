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
