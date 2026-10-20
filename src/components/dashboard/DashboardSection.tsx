import type { ReactNode } from 'react'

import { Surface } from '@/components/ui/Surface'
import { cn } from '@/utils/cn'

type DashboardSectionProps = {
  title: string
  /** Trailing affordance in the title bar, e.g. a link to the full page. */
  action?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * A titled dashboard block. Owns the card chrome and the `h2` heading so every
 * section on the dashboard stays identical without repeating markup.
 */
export function DashboardSection({ title, action, children, className }: DashboardSectionProps) {
  return (
    <section className={cn('flex flex-col', className)}>
      <Surface className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
          <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
          {action}
        </div>

        <div className="flex flex-1 flex-col p-4">{children}</div>
      </Surface>
    </section>
  )
}
