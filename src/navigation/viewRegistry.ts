import type { ComponentType } from 'react'

import { ArchivePage } from '@/pages/ArchivePage'
import { HomePage } from '@/pages/HomePage'
import { NotesPage } from '@/pages/NotesPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SnippetsPage } from '@/pages/SnippetsPage'
import { TasksPage } from '@/pages/TasksPage'
import type { PageProps, ViewId } from '@/types/navigation'

/**
 * View id → page component.
 *
 * The shell stays mounted while this map swaps the content area, which is the
 * whole point of keeping navigation in state rather than re-mounting the app.
 * Typing it as an exhaustive record means adding a view to `ViewId` without a
 * page is a compile error.
 *
 * Every page receives {@link PageProps}; pages that ignore them are still
 * assignable.
 */
export const VIEW_COMPONENTS: Record<ViewId, ComponentType<PageProps>> = {
  home: HomePage,
  notes: NotesPage,
  tasks: TasksPage,
  snippets: SnippetsPage,
  archive: ArchivePage,
  settings: SettingsPage,
}
