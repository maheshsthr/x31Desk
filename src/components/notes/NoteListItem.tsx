import type { Note } from '@/types/note'
import { cn } from '@/utils/cn'
import { formatShortDate } from '@/utils/date'

type NoteListItemProps = {
  note: Note
  isActive: boolean
  onSelect: (id: string) => void
}

/** Untitled notes still need a name in the list. */
const UNTITLED = 'Untitled note'
const NO_PREVIEW = 'No additional text'

/**
 * First line of the body, collapsed to a single line for the list row.
 * Duplicating the title here would waste the only preview line available.
 */
function previewOf(content: string): string {
  const line = content.split('\n').find((entry) => entry.trim() !== '')

  return line ? line.replace(/\s+/g, ' ').trim() : NO_PREVIEW
}

/** One row of the notes list: title, a one-line preview and the last edit date. */
export function NoteListItem({ note, isActive, onSelect }: NoteListItemProps) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(note.id)}
        aria-current={isActive ? 'true' : undefined}
        className={cn(
          'block w-full rounded-sm px-2.5 py-2 text-left transition-colors duration-150 ease-standard',
          isActive ? 'bg-accent-soft' : 'hover:bg-canvas',
        )}
      >
        <span
          className={cn(
            'block truncate text-sm font-medium',
            isActive ? 'text-accent' : 'text-ink',
          )}
        >
          {note.title.trim() || UNTITLED}
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-muted">
          {previewOf(note.content)}
        </span>
        <span className="mt-1 block text-2xs text-ink-muted">
          {formatShortDate(note.updatedAt)}
        </span>
      </button>
    </li>
  )
}
