import type { LucideIcon } from 'lucide-react'

import { cn } from '@/utils/cn'

type NavItemProps = {
  icon: LucideIcon
  label: string
  isActive: boolean
  onSelect: () => void
  className?: string
  shortcut?: string
  title?: string
}

/**
 * One row in the sidebar navigation. Rendered as a button because navigation is
 * state-based; `aria-current="page"` marks the active destination for screen
 * readers and mirrors the blue highlight.
 */
export function NavItem({ icon: Icon, label, isActive, onSelect, className, shortcut, title }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isActive ? 'page' : undefined}
      title={title}
      className={cn(
        'group flex h-8 w-full shrink-0 items-center gap-2.5 rounded-sm px-2 text-left text-sm transition-colors duration-150 ease-standard',
        isActive
          ? 'bg-accent-soft font-medium text-accent'
          : 'text-ink-muted hover:bg-nav-hover hover:text-ink',
        className,
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={isActive ? 2.1 : 1.9}
        className={cn(
          'size-4 shrink-0',
          isActive ? 'text-accent' : 'text-ink-muted group-hover:text-ink',
        )}
      />
      <span className="min-w-0 flex-1 truncate" data-nav-label={label}>{label}</span>
      {shortcut ? (
        <span aria-hidden="true" className="ml-auto shrink-0 font-mono text-[10px] text-ink-muted/70">{shortcut}</span>
      ) : null}
      {shortcut ? <span className="sr-only"> {shortcut}</span> : null}
    </button>
  )
}
