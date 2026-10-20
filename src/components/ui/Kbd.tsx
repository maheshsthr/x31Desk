import type { ReactNode } from 'react'

type KbdProps = {
  /** The rendered key or combination, already spelled by `formatBinding`. */
  children: ReactNode
}

/**
 * One key or combination, rendered the way the workspace-search field has
 * always shown its hint.
 *
 * The single home for `<kbd>` styling: the search field and the Settings
 * shortcut list both render keys through this component, so the chip can
 * never look different in one place than in the other.
 */
export function Kbd({ children }: KbdProps) {
  return (
    <kbd className="rounded-xs border border-line bg-surface px-1 py-0.5 text-2xs text-ink-muted">
      {children}
    </kbd>
  )
}
