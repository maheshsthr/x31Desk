import type { ReactNode } from 'react'

import { cn } from '@/utils/cn'

type PageHeaderProps = {
  /** Small label above the title, e.g. a workspace or status indicator. */
  eyebrow?: ReactNode
  title: string
  description?: string
  /** Actions aligned to the trailing edge, e.g. the quick-action buttons. */
  actions?: ReactNode
  className?: string
}

/**
 * Standard page header: the heading block for a view plus its trailing actions.
 * The breadcrumb in the top bar covers *where* you are; this covers *what* the
 * page is.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="flex flex-wrap items-center gap-2.5">{eyebrow}</div> : null}
        <h1
          className={cn(
            'text-2xl font-semibold tracking-tight text-balance text-ink',
            eyebrow ? 'mt-2.5' : undefined,
          )}
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-prose text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>

      {/*
        The actions may wrap *within* themselves once their buttons no longer fit
        beside the title on a narrow window: `shrink-0` would instead push them
        past the pane's edge, so the container shrinks and the buttons flow onto
        another line.
      */}
      {actions ? (
        <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
      ) : null}
    </header>
  )
}
