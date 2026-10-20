import { Archive, Check, CircleAlert, LoaderCircle, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Surface } from '@/components/ui/Surface'
import type { NoteSaveStatus } from '@/hooks/useNotes'
import type { Note, NoteDraft } from '@/types/note'
import { cn } from '@/utils/cn'
import { formatDateTime } from '@/utils/date'
import { truncate } from '@/utils/text'

type NoteEditorProps = {
  note: Note
  status: NoteSaveStatus
  /**
   * A short reason a write failed (for example `storage full`), or `null` when
   * there is nothing confident to add to the plain "Not saved" indicator.
   */
  errorSummary: string | null
  /**
   * Increments when a note was just created, so a brand new note opens with the
   * caret in its title without stealing focus on every selection change.
   */
  focusToken: number
  onChange: (draft: NoteDraft) => void
  onArchive: () => void
  onDelete: () => void
  className?: string
}

/**
 * Quiet save indicator. The container reserves a minimum width so the Delete
 * button beside it does not move between an empty and a non-empty state; an
 * error reason is allowed to widen it leftward, which still leaves the buttons
 * anchored to the right edge.
 */
function SaveStatus({ status, summary }: { status: NoteSaveStatus; summary: string | null }) {
  return (
    <span
      role="status"
      className={cn(
        'flex min-w-20 items-center justify-end gap-1 whitespace-nowrap text-2xs',
        status === 'error' ? 'text-danger' : 'text-ink-muted',
      )}
    >
      {status === 'saving' ? (
        <>
          <LoaderCircle aria-hidden strokeWidth={2} className="size-3 shrink-0 animate-spin" />
          Saving…
        </>
      ) : null}
      {status === 'saved' ? (
        <>
          <Check aria-hidden strokeWidth={2.2} className="size-3 shrink-0" />
          Saved
        </>
      ) : null}
      {status === 'error' ? (
        <>
          <CircleAlert aria-hidden strokeWidth={2} className="size-3 shrink-0" />
          Not saved{summary ? ` · ${summary}` : ''}
        </>
      ) : null}
    </span>
  )
}

/**
 * The right pane: the open note. Title and body are edited in place and written
 * back through `onChange`; the panel never keeps a second copy of the note, so
 * the list and the editor can never disagree.
 */
export function NoteEditor({
  note,
  status,
  errorSummary,
  focusToken,
  onChange,
  onArchive,
  onDelete,
  className,
}: NoteEditorProps) {
  const titleRef = useRef<HTMLInputElement>(null)
  const [isConfirming, setIsConfirming] = useState(false)

  const titleFieldId = useId()
  const contentFieldId = useId()

  useEffect(() => {
    if (focusToken > 0) {
      titleRef.current?.focus()
    }
  }, [focusToken])

  const shortenedTitle = truncate(note.title)

  return (
    <Surface className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={titleFieldId} className="sr-only">
            Note title
          </label>
          <input
            id={titleFieldId}
            ref={titleRef}
            // Focus target for the global `F2` rename shortcut: the shell looks
            // for `[data-rename-target]` and selects this field.
            data-rename-target
            value={note.title}
            onChange={(event) => onChange({ title: event.target.value, content: note.content })}
            placeholder="Untitled note"
            className="w-full rounded-xs bg-transparent text-lg font-semibold text-ink placeholder:text-ink-muted"
          />
          <p className="mt-1 text-2xs text-ink-muted">
            Created {formatDateTime(note.createdAt)} · Updated {formatDateTime(note.updatedAt)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <SaveStatus status={status} summary={errorSummary} />
          <Button
            variant="ghost"
            size="sm"
            icon={Archive}
            className="hover:bg-accent-soft hover:text-accent"
            onClick={onArchive}
          >
            Archive
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            className="hover:bg-danger-soft hover:text-danger"
            onClick={() => setIsConfirming(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-1">
        <label htmlFor={contentFieldId} className="sr-only">
          Note content
        </label>
        <textarea
          id={contentFieldId}
          value={note.content}
          onChange={(event) => onChange({ title: note.title, content: event.target.value })}
          placeholder="Start writing…"
          className="min-h-0 flex-1 resize-none rounded-sm bg-transparent px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-ink-muted"
        />
      </div>

      <ConfirmDialog
        open={isConfirming}
        title="Delete this note?"
        description={
          shortenedTitle
            ? `“${shortenedTitle}” will be deleted from this device. This cannot be undone.`
            : 'This note will be deleted from this device. This cannot be undone.'
        }
        confirmLabel="Delete note"
        destructive
        onCancel={() => setIsConfirming(false)}
        onConfirm={() => {
          setIsConfirming(false)
          onDelete()
        }}
      />
    </Surface>
  )
}
