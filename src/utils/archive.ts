import type { ArchivedItem, ArchiveFilter, ArchiveItemType } from '@/types/archive'

/** Singular display name of each kind, for buttons and notifications. */
export const ARCHIVE_TYPE_LABELS: Record<ArchiveItemType, string> = {
  note: 'Note',
  task: 'Task',
  snippet: 'Snippet',
}

/** Filter tabs, in presentation order. `all` leads because it is the widest. */
export const ARCHIVE_FILTERS: readonly { readonly id: ArchiveFilter; readonly label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'note', label: 'Notes' },
  { id: 'task', label: 'Tasks' },
  { id: 'snippet', label: 'Snippets' },
]

/** A record still needs a name in the archive even when it never had one. */
export function archivedTitle(item: ArchivedItem): string {
  switch (item.type) {
    case 'note':
      return item.note.title.trim() || 'Untitled note'
    case 'task':
      return item.task.title.trim() || 'Untitled task'
    case 'snippet':
      return item.snippet.title.trim() || 'Untitled snippet'
  }
}

/** First meaningful line of a block of text, collapsed for a single list row. */
function firstLine(text: string): string {
  const line = text.split('\n').find((entry) => entry.trim() !== '')

  return line ? line.replace(/\s+/g, ' ').trim() : ''
}

/**
 * One-line preview of the record's body, matching how each workspace previews
 * its own rows: a note's first line, a task's description, a snippet's code.
 */
export function archivedPreview(item: ArchivedItem): string {
  switch (item.type) {
    case 'note':
      return firstLine(item.note.content)
    case 'task':
      return item.task.description.replace(/\s+/g, ' ').trim()
    case 'snippet':
      return firstLine(item.snippet.code)
  }
}

/**
 * Everything a title/content search should look through, lower-cased once.
 *
 * "Where practical" is taken literally: each kind searches the fields it
 * actually has rather than a lowest common denominator, so a snippet is
 * findable by a tag and a task by its description as well as its title.
 */
function archiveSearchText(item: ArchivedItem): string {
  switch (item.type) {
    case 'note':
      return `${item.note.title}\n${item.note.content}`.toLowerCase()
    case 'task':
      return `${item.task.title}\n${item.task.description}`.toLowerCase()
    case 'snippet':
      return `${item.snippet.title}\n${item.snippet.code}\n${item.snippet.tags.join(' ')}`.toLowerCase()
  }
}

/** How many archived records fall under each filter, including the total. */
export function archiveCounts(items: readonly ArchivedItem[]): Record<ArchiveFilter, number> {
  const counts: Record<ArchiveFilter, number> = { all: items.length, note: 0, task: 0, snippet: 0 }

  for (const item of items) {
    counts[item.type] += 1
  }

  return counts
}

/**
 * The archived records to render for one filter and search, most recently
 * archived first. Returns a fresh array, so callers can slice it freely.
 *
 * Order is decided by `archivedAt` alone, and the sort is stable, so two records
 * archived in the same millisecond keep the order they arrived in. That order is
 * the same under either backend: the `localStorage` archive prepends, and the
 * SQLite archive orders `archived_at DESC, rowid DESC`, so both hand back the
 * most recently *added* first for a tie. The display therefore does not depend
 * on which storage a record came from, which is what lets the backend be
 * switched without the list re-ordering. The display side is pinned in
 * `tests/archiveOrder.test.ts`; the two backends actually agreeing is pinned by
 * running both through `tests/repositoryConformance.test.ts`.
 */
export function selectArchivedItems(
  items: readonly ArchivedItem[],
  filter: ArchiveFilter,
  query: string,
): ArchivedItem[] {
  const needle = query.trim().toLowerCase()

  return items
    .filter((item) => {
      if (filter !== 'all' && item.type !== filter) {
        return false
      }

      return needle === '' || archiveSearchText(item).includes(needle)
    })
    .sort((a, b) => b.archivedAt - a.archivedAt)
}
