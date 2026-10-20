import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { TaskDraft, TaskPriority } from '@/types/task'
import { PRIORITY_OPTIONS } from '@/utils/task'

type TaskDialogProps = {
  open: boolean
  /** `create` adds a task; `edit` changes an existing one. */
  mode: 'create' | 'edit'
  /**
   * Values the fields start from. Must be referentially stable while the dialog
   * is open — it is read when the dialog opens, to seed the fields.
   */
  initial: TaskDraft
  onSubmit: (draft: TaskDraft) => void
  onCancel: () => void
}

/** Shared field styling, so the four controls cannot drift apart. */
const FIELD_CLASSES =
  'w-full rounded-sm border border-line bg-surface px-2.5 text-sm text-ink transition-colors duration-150 ease-standard placeholder:text-ink-muted hover:border-accent/40'

/**
 * Create/edit form for a task, in a native `<dialog>`.
 *
 * Fields are local state rather than living on the task, so a half-finished edit
 * can be abandoned with Cancel and nothing is written until the form is
 * submitted. `open` is the single source of truth; the element only follows it.
 */
export function TaskDialog({ open, mode, initial, onSubmit, onCancel }: TaskDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  const headingId = useId()
  const titleFieldId = useId()
  const descriptionFieldId = useId()
  const dueDateFieldId = useId()
  const errorId = useId()

  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description)
  const [dueDate, setDueDate] = useState(initial.dueDate ?? '')
  const [priority, setPriority] = useState<TaskPriority>(initial.priority)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current

    if (!dialog) {
      return
    }

    if (open && !dialog.open) {
      // Seed the fields from whatever is being created or edited. Done on the
      // open transition so typing is never interrupted by a re-seed.
      setTitle(initial.title)
      setDescription(initial.description)
      setDueDate(initial.dueDate ?? '')
      setPriority(initial.priority)
      setError(null)

      dialog.showModal()
      titleRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open, initial])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedTitle = title.trim()

    if (trimmedTitle === '') {
      setError('Give the task a title.')
      titleRef.current?.focus()
      return
    }

    onSubmit({
      title: trimmedTitle,
      description: description.trim(),
      dueDate: dueDate === '' ? null : dueDate,
      priority,
    })
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      // `Esc` closes natively; reporting it through `onCancel` keeps the parent
      // state in step instead of letting the element close behind its back.
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      // A click lands on the dialog itself only when it hits the backdrop.
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          onCancel()
        }
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[28rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-line bg-surface p-0 text-ink shadow-floating backdrop:bg-scrim"
    >
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
        <h2 id={headingId} className="text-sm font-semibold text-ink">
          {mode === 'create' ? 'New task' : 'Edit task'}
        </h2>

        <div>
          <label htmlFor={titleFieldId} className="block text-xs font-medium text-ink">
            Title
          </label>
          <input
            id={titleFieldId}
            ref={titleRef}
            value={title}
            required
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setTitle(event.target.value)

              if (error) {
                setError(null)
              }
            }}
            placeholder="What needs doing?"
            className={`mt-1.5 h-8 ${FIELD_CLASSES}`}
          />
          {error ? (
            <p id={errorId} role="alert" className="mt-1.5 text-2xs text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={descriptionFieldId} className="block text-xs font-medium text-ink">
            Description <span className="font-regular text-ink-muted">(optional)</span>
          </label>
          <textarea
            id={descriptionFieldId}
            value={description}
            rows={2}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add any detail worth remembering."
            className={`mt-1.5 resize-none py-1.5 ${FIELD_CLASSES}`}
          />
        </div>

        <div>
          <label htmlFor={dueDateFieldId} className="block text-xs font-medium text-ink">
            Due date <span className="font-regular text-ink-muted">(optional)</span>
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id={dueDateFieldId}
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className={`h-8 flex-1 ${FIELD_CLASSES}`}
            />
            {dueDate !== '' ? (
              <Button size="sm" variant="ghost" onClick={() => setDueDate('')}>
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        <div>
          <span className="block text-xs font-medium text-ink">Priority</span>
          <SegmentedControl
            className="mt-1.5"
            label="Priority"
            options={PRIORITY_OPTIONS}
            value={priority}
            onChange={setPriority}
          />
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary">
            {mode === 'create' ? 'Create task' : 'Save changes'}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
