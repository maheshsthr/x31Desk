import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Surface } from '@/components/ui/Surface'
import { cn } from '@/utils/cn'

type EmptyStateVariant = 'panel' | 'inline'

type EmptyStateProps = {
  icon: LucideIcon
  title: string
  description: string
  /**
   * `panel` — stands alone as page content, so it draws its own dashed surface
   * and renders the title as an `h2` under the page `h1`.
   *
   * `inline` — sits inside a card that already provides the border and the
   * section heading, so it adds no chrome of its own, fills the available
   * height and renders the title as plain text.
   */
  variant?: EmptyStateVariant
  /** Optional control that resolves the empty state, e.g. a "New note" button. */
  action?: ReactNode
  className?: string
}

const panelClasses = 'flex flex-col items-center border-dashed px-6 py-10 text-center'
const inlineClasses =
  'flex flex-1 flex-col items-center justify-center px-4 py-8 text-center'

/**
 * Restrained placeholder for areas that hold no content yet. Deliberately quiet:
 * a tinted icon and two lines of text.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  variant = 'panel',
  action,
  className,
}: EmptyStateProps) {
  const TitleTag = variant === 'inline' ? 'p' : 'h2'

  const content = (
    <>
      <span className="grid size-9 place-items-center rounded-sm bg-accent-soft text-accent">
        <Icon aria-hidden className="size-4.5" strokeWidth={1.8} />
      </span>
      <TitleTag className="mt-3 text-sm font-semibold text-ink">{title}</TitleTag>
      <p className="mt-1 max-w-md text-xs text-ink-muted">{description}</p>
      {action ? <div className="mt-3.5">{action}</div> : null}
    </>
  )

  if (variant === 'inline') {
    return <div className={cn(inlineClasses, className)}>{content}</div>
  }

  return <Surface className={cn(panelClasses, className)}>{content}</Surface>
}
