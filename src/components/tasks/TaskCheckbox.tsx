import { cn } from '@/utils/cn'

type TaskCheckboxProps = {
  checked: boolean
  /** What the checkbox controls; becomes the accessible action's subject. */
  label: string
  onChange: (checked: boolean) => void
  className?: string
}

/**
 * Completion toggle.
 *
 * A real `<input type="checkbox">` is used rather than a styled button: the
 * native control keeps its keyboard behaviour and screen-reader semantics for
 * free, and `accent-color` is enough to make it match the accent without
 * repainting it. The wrapping label widens the hit target past the 16px box.
 */
export function TaskCheckbox({ checked, label, onChange, className }: TaskCheckboxProps) {
  const subject = label.trim() || 'this task'

  return (
    <label className={cn('grid shrink-0 cursor-pointer place-items-center p-1', className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={checked ? `Reopen ${subject}` : `Complete ${subject}`}
        className="size-4 cursor-pointer accent-accent"
      />
    </label>
  )
}
