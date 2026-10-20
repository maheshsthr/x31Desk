import { useEffect, useId, useRef } from 'react'

import { Button } from '@/components/ui/Button'

type ConfirmDialogProps = {
  open: boolean
  title: string
  description: string
  /** Label of the confirming action, e.g. "Delete note". */
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  /** Styles the confirming action as destructive. */
  destructive?: boolean
}

/**
 * Small modal confirmation for actions that cannot be undone.
 *
 * Built on the native `<dialog>` element on purpose: `showModal()` gives focus
 * trapping, inertness of the page behind it and `Esc` handling for free, which
 * is markedly more robust than a hand-rolled overlay.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = false,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  // The `open` prop is the single source of truth; the element only follows it.
  useEffect(() => {
    const dialog = dialogRef.current

    if (!dialog) {
      return
    }

    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
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
      className="m-auto max-h-[calc(100dvh-2rem)] w-[24rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-line bg-surface p-0 text-ink shadow-floating backdrop:bg-scrim"
    >
      <div className="p-5">
        <h2 id={titleId} className="text-sm font-semibold text-ink">
          {title}
        </h2>
        <p className="mt-1.5 text-xs text-ink-muted">{description}</p>

        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
