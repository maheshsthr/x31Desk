import { Archive, Code, House, NotebookPen, Settings, SquareCheckBig } from 'lucide-react'

import type { NavEntry, ViewId } from '@/types/navigation'

/** The view shown when the application starts. */
export const DEFAULT_VIEW: ViewId = 'home'

/** Primary workspace destinations, rendered at the top of the sidebar. */
export const PRIMARY_NAV: readonly NavEntry[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
  { id: 'tasks', label: 'Tasks', icon: SquareCheckBig },
  { id: 'snippets', label: 'Snippets', icon: Code },
  { id: 'archive', label: 'Archive', icon: Archive },
]

/** Secondary destinations, pinned to the bottom of the sidebar. */
export const SECONDARY_NAV: readonly NavEntry[] = [{ id: 'settings', label: 'Settings', icon: Settings }]

/** Every destination, useful for lookups by id. */
export const ALL_NAV: readonly NavEntry[] = [...PRIMARY_NAV, ...SECONDARY_NAV]

/**
 * Resolves a view id to its navigation entry. Keeps titles and icons in one
 * place instead of repeating them per view.
 */
export function getNavEntry(id: ViewId): NavEntry {
  const entry = ALL_NAV.find((candidate) => candidate.id === id)

  if (!entry) {
    throw new Error(`No navigation entry registered for view "${id}"`)
  }

  return entry
}
