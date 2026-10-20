import { Archive, Check, CircleAlert, LoaderCircle, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'

import { CodeEditor } from '@/components/snippets/CodeEditor'
import { CopyButton } from '@/components/snippets/CopyButton'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Select } from '@/components/ui/Select'
import { Surface } from '@/components/ui/Surface'
import type { SnippetSaveStatus } from '@/hooks/useSnippets'
import { isSnippetDraftComplete, type Snippet, type SnippetDraft } from '@/types/snippet'
import { cn } from '@/utils/cn'
import { formatDateTime } from '@/utils/date'
import { SNIPPET_LANGUAGES, countLines } from '@/utils/snippet'
import { truncate } from '@/utils/text'

type SnippetEditorProps = {
  /** The stored snippet being edited, or `null` while a new one is unsaved. */
  snippet: Snippet | null
  draft: SnippetDraft
  status: SnippetSaveStatus
  /** A short reason a write failed, or `null` for the plain indicator. */
  errorSummary: string | null
  onChange: (draft: SnippetDraft) => void
  onArchive: () => void
  onDelete: () => void
  className?: string
}

/** Shared field styling, so the text fields cannot drift apart. */
const FIELD_CLASSES =
  'w-full rounded-sm border border-line bg-surface px-2.5 text-sm text-ink transition-colors duration-150 ease-standard placeholder:text-ink-muted hover:border-accent/40'

/**
 * Quiet save indicator. The container reserves a minimum width so the buttons
 * beside it do not move between an empty and a non-empty state; an error reason
 * is allowed to widen it leftward, which still leaves the buttons anchored to
 * the right edge.
 */
function SaveStatus({
  status,
  summary,
}: {
  status: SnippetSaveStatus
  summary: string | null
}) {
  return (
    <span
      role="status"
      className={cn(
        'flex min-w-20 items-center justify-end gap-1 whitespace-nowrap text-2xs',
        status === 'incomplete'
          ? 'text-warning'
          : status === 'error'
            ? 'text-danger'
            : 'text-ink-muted',
      )}
    >
      {status === 'incomplete' ? (
        <>
          <CircleAlert aria-hidden strokeWidth={2} className="size-3 shrink-0" />
          Unsaved
        </>
      ) : null}
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
 * The right pane: the open snippet.
 *
 * Title, language, tags and code are edited in place and written back through
 * `onChange`; the panel keeps no copy of its own, so the list and the editor
 * cannot disagree about what was typed. A brand new snippet is identified by
 * `snippet === null` — it has no stored record until it is complete.
 */
export function SnippetEditor({
  snippet,
  draft,
  status,
  errorSummary,
  onChange,
  onArchive,
  onDelete,
  className,
}: SnippetEditorProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)

  const titleFieldId = useId()
  const tagsFieldId = useId()

  const isComplete = isSnippetDraftComplete(draft)
  const lineCount = countLines(draft.code)
  const title = draft.title.trim() || 'this snippet'

  return (
    <Surface className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="shrink-0 border-b border-line px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor={titleFieldId} className="sr-only">
              Snippet title
            </label>
            <input
              id={titleFieldId}
              // Focus target for the global `F2` rename shortcut (see
              // `useShellShortcuts`), which selects this field.
              data-rename-target
              value={draft.title}
              autoFocus={snippet === null}
              onChange={(event) => onChange({ ...draft, title: event.target.value })}
              placeholder="Snippet title"
              aria-invalid={draft.title.trim() === ''}
              className="w-full rounded-xs bg-transparent text-lg font-semibold text-ink placeholder:text-ink-muted"
            />
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <SaveStatus status={status} summary={errorSummary} />
            <CopyButton
              text={draft.code}
              label="Copy code"
              shortcut="Ctrl Shift C"
              disabled={draft.code === ''}
            />
            {snippet ? (
              <Button
                variant="ghost"
                size="sm"
                icon={Archive}
                className="hover:bg-accent-soft hover:text-accent"
                onClick={onArchive}
              >
                Archive
              </Button>
            ) : null}
            {snippet ? (
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                className="hover:bg-danger-soft hover:text-danger"
                onClick={() => setIsConfirmingDelete(true)}
              >
                Delete
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[9rem_1fr]">
          <Select
            label="Language"
            showLabel
            options={SNIPPET_LANGUAGES}
            value={draft.language}
            onChange={(language) => onChange({ ...draft, language })}
          />

          <div className="min-w-0">
            <label htmlFor={tagsFieldId} className="block text-xs font-medium text-ink">
              Tags <span className="font-normal text-ink-muted">(comma-separated, optional)</span>
            </label>
            <input
              id={tagsFieldId}
              value={draft.tags}
              onChange={(event) => onChange({ ...draft, tags: event.target.value })}
              placeholder="react, hooks, forms"
              className={cn('mt-1 h-8', FIELD_CLASSES)}
            />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs">
          <span className="text-ink-muted">
            {snippet
              ? `Created ${formatDateTime(snippet.createdAt)} · Updated ${formatDateTime(snippet.updatedAt)}`
              : 'Not saved yet'}
          </span>
          {isComplete ? null : (
            <span className="text-warning">
              A title and code are required before this snippet is saved.
            </span>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
          <span className="text-2xs font-semibold tracking-wide text-ink-muted uppercase">Code</span>
          <span className="text-2xs text-ink-muted">
            {lineCount === 1 ? '1 line' : `${lineCount} lines`}
          </span>
        </div>

        <CodeEditor
          value={draft.code}
          language={draft.language}
          onChange={(code) => onChange({ ...draft, code })}
          label="Snippet code"
          invalid={draft.code.trim() === ''}
          className="flex-1"
        />
      </div>

      <ConfirmDialog
        open={isConfirmingDelete}
        title="Delete this snippet?"
        description={`“${truncate(title)}” will be deleted from this device. This cannot be undone.`}
        confirmLabel="Delete snippet"
        destructive
        onCancel={() => setIsConfirmingDelete(false)}
        onConfirm={() => {
          setIsConfirmingDelete(false)
          onDelete()
        }}
      />
    </Surface>
  )
}
