import { Search, SearchX, X } from 'lucide-react'

import { NoteListItem } from '@/components/notes/NoteListItem'
import { IconButton } from '@/components/ui/IconButton'
import { Surface } from '@/components/ui/Surface'
import type { Note } from '@/types/note'
import { cn } from '@/utils/cn'

type NotesListProps = {
  /** Notes after filtering. */
  notes: readonly Note[]
  /** Total number of notes, needed to tell "no matches" from "no notes". */
  totalCount: number
  query: string
  onQueryChange: (query: string) => void
  selectedId: string | null
  onSelect: (id: string) => void
  className?: string
}

/**
 * The left pane of the notes workspace: a search field and the filtered list.
 * It scrolls on its own so the editor beside it keeps a stable height.
 */
export function NotesList({
  notes,
  totalCount,
  query,
  onQueryChange,
  selectedId,
  onSelect,
  className,
}: NotesListProps) {
  const isFiltering = query.trim() !== ''

  return (
    <Surface className={cn('flex min-h-0 flex-col', className)}>
      <div className="shrink-0 border-b border-line p-3">
        <div className="relative">
          <Search
            aria-hidden
            strokeWidth={1.9}
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-muted"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search notes"
            aria-label="Search notes"
            className="h-8 w-full rounded-sm border border-line bg-surface pr-8 pl-8 text-sm text-ink transition-colors duration-150 ease-standard placeholder:text-ink-muted hover:border-accent/40"
          />
          {isFiltering ? (
            <IconButton
              icon={X}
              label="Clear search"
              onClick={() => onQueryChange('')}
              className="absolute top-1/2 right-1 size-6 -translate-y-1/2"
            />
          ) : null}
        </div>

        <p className="mt-2 text-2xs text-ink-muted">
          {isFiltering
            ? `${notes.length} of ${totalCount} notes`
            : `${totalCount} ${totalCount === 1 ? 'note' : 'notes'}`}
        </p>
      </div>

      {notes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
          <SearchX aria-hidden strokeWidth={1.8} className="size-4.5 text-ink-muted" />
          <p className="mt-2 text-xs font-medium text-ink">No matching notes</p>
          <p className="mt-1 text-2xs text-ink-muted">Try a different title or keyword.</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
          {notes.map((note) => (
            <NoteListItem
              key={note.id}
              note={note}
              isActive={note.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </Surface>
  )
}
