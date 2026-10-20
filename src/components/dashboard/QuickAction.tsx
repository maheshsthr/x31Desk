import type { LucideIcon } from 'lucide-react'

import { cn } from '@/utils/cn'

type QuickActionProps = {
  icon: LucideIcon
  label: string
  onClick: () => void
  className?: string
}

/**
 * Compact dashboard action: a small pill rather than a card, with a soft accent
 * wash on hover so the whole row reads as one click target.
 */
export function QuickAction({ icon: Icon, label, onClick, className }: QuickActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group inline-flex h-9 shrink-0 items-center gap-2 rounded-sm border border-line bg-surface px-3 text-sm text-ink transition-colors duration-150 ease-standard hover:border-accent/40 hover:bg-accent-soft hover:text-accent',
        className,
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={1.9}
        className="size-4 shrink-0 text-ink-muted transition-colors duration-150 ease-standard group-hover:text-accent"
      />
      <span className="truncate">{label}</span>
    </button>
  )
}
