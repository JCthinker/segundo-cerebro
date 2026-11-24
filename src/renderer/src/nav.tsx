import { createContext, useContext } from 'react'
import type { Item } from '@shared/types'

export type Page = 'today' | 'notes' | 'history' | 'settings' | 'sources' | 'workflow'

export interface Nav {
  page: Page
  go: (page: Page, param?: string) => void
  param: string | null
  /** Abre una conversación nueva con Claude (sobre una tarea, si se da). */
  resolve: (item: Item | null, goal?: string) => void
  /** Le manda un mensaje a Claude en el panel de la derecha (lo abre si hace falta). */
  talk: (text: string) => void
  editItem: (item: Item | null, defaults?: Partial<Item>) => void
}

export const NavContext = createContext<Nav>(null as unknown as Nav)
export const useNav = () => useContext(NavContext)
