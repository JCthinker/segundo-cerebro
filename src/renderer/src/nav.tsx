import { createContext, useContext } from 'react'
import type { Item } from '@shared/types'

export type Page = 'today' | 'inbox' | 'notes' | 'promises' | 'deadlines' | 'workflow' | 'sources' | 'ask' | 'settings'

export interface Nav {
  page: Page
  go: (page: Page, param?: string) => void
  param: string | null
  resolve: (item: Item | null, goal?: string) => void
  editItem: (item: Item | null, defaults?: Partial<Item>) => void
}

export const NavContext = createContext<Nav>(null as unknown as Nav)
export const useNav = () => useContext(NavContext)
