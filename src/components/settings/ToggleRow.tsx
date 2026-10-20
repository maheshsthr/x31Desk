type ToggleRowProps = {
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

/**
 * A settings row that reads as a single labelled switch.
 *
 * The whole row is a `<label>`, so the visible title *is* the control's
 * accessible name and clicking anywhere on the row flips it. The checkbox is a
 * real input — keyboard, screen readers and form semantics for free — hidden
 * behind the drawn track and thumb; its focus ring is forwarded to the track.
 */
export function ToggleRow({ title, description, checked, onChange }: ToggleRowProps) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>
      </span>

      <span className="relative inline-flex h-[1.25rem] w-[2.25rem] shrink-0 items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border border-line bg-canvas transition-colors duration-150 ease-standard peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-[2px] top-[2px] size-[1rem] rounded-full bg-ink-muted shadow-sm transition-transform duration-150 ease-standard peer-checked:translate-x-[1rem] peer-checked:bg-on-accent"
        />
      </span>
    </label>
  )
}
