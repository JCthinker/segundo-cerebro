import { describe, expect, it, vi } from 'vitest'

// La memoria de correcciones se guarda en ajustes: los simulamos en memoria.
const store = new Map<string, string>()
vi.mock('../src/main/db', () => ({
  getSetting: (k: string) => store.get(k) ?? null,
  setSetting: (k: string, v: string | null) => (v === null ? store.delete(k) : store.set(k, v))
}))

const { learn, lessonsForPrompt, forgetLesson, listLessons, hideFlow, hiddenFlow, lessonsSinceSuggest, markSuggested } = await import('../src/main/learning')

describe('lo que Claude aprende', () => {
  it('apunta correcciones y las pasa al prompt, la más reciente primero', () => {
    learn('flujo', 'primera')
    learn('novedades', 'segunda')
    learn('flujo', '   ')
    expect(listLessons()).toHaveLength(2)
    expect(lessonsForPrompt().split('\n')[0]).toMatch(/novedades\) segunda$/)
  })

  it('se puede olvidar una corrección', () => {
    const before = listLessons().length
    forgetLesson(listLessons()[0].at)
    expect(listLessons().length).toBeLessThan(before)
  })

  it('cuenta las correcciones nuevas desde la última propuesta de reglas', () => {
    markSuggested()
    expect(lessonsSinceSuggest()).toBe(0)
  })

  it('«No hace falta» oculta dos semanas y lo apunta', () => {
    const before = listLessons().length
    hideFlow('tasks:ROAD-1', 'notNeeded', 'Crear las tareas')
    expect(Object.keys(hiddenFlow())).toEqual(['tasks:ROAD-1'])
    expect(listLessons().length).toBe(before + 1)
  })
})
