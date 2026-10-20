import type { ArchivedItem } from '@/types/archive'
import type { Note } from '@/types/note'
import type { Snippet } from '@/types/snippet'
import type { Task } from '@/types/task'

/**
 * Which workspace a search result belongs to.
 *
 * `archive` is a section of its own rather than a fourth record kind: an
 * archived note is still a note, but it lives somewhere else and opening it
 * means going to the Archive workspace, so the result has to say so.
 */
export type SearchResultKind = 'note' | 'task' | 'snippet' | 'archive'

/** One thing the workspace search found, ready to render as a single row. */
export type SearchResult = {
  kind: SearchResultKind
  /** Id of the record an "open" intent should target. */
  id: string
  title: string
  /** One-line body preview, or an empty string when there is nothing to show. */
  preview: string
  /** Short badge beside the title — a snippet's language, an item's type. */
  meta?: string
}

/** A result paired with its position in the flat, keyboard-navigable order. */
export type SearchEntry = {
  result: SearchResult
  index: number
}

/** One titled section of the results dropdown. */
export type SearchGroup = {
  kind: SearchResultKind
  label: string
  entries: SearchEntry[]
  /** Matches in this section before it was capped for display. */
  total: number
}

/** Everything the dropdown renders for one query. */
export type SearchResults = {
  groups: SearchGroup[]
  /** The rendered results in keyboard order, across every group. */
  flat: SearchResult[]
  /** Total matches, which may exceed `flat.length` once groups are capped. */
  total: number
}

/** The collections the workspace search looks through. */
export type WorkspaceDocuments = {
  notes: readonly Note[]
  tasks: readonly Task[]
  snippets: readonly Snippet[]
  archive: readonly ArchivedItem[]
}
