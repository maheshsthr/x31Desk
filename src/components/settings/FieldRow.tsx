import type { ReactNode } from 'react'

type FieldRowProps = {
  title: string
  description: string
  /**
   * The control for this setting. It carries its own accessible name (an
   * `aria-label` or an associated label), because the row's title is plain text
   * rather than a `<label>` binding.
   */
  children: ReactNode
}

/**
 * A settings row pairing a titled description with a control on the trailing
 * edge. Wraps to a second line on narrow widths so a wide control never crushes
 * the text.
 */
export function FieldRow({ title, description, children }: FieldRowProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-xs text-ink-muted">{description}</p>
      </div>

      <div className="min-w-0">{children}</div>
    </div>
  )
}
