import type { LucideIcon } from 'lucide-react'

import { Surface } from '@/components/ui/Surface'
import { cn } from '@/utils/cn'

type StatCardProps = {
  icon: LucideIcon
  /** What the count represents, e.g. "Tasks due today". */
  label: string
  /** Current count. Reads from the workspace store once one exists. */
  value: number
  className?: string
}

/** Compact overview metric: tinted icon, label and a single count. */
export function StatCard({ icon: Icon, label, value, className }: StatCardProps) {
  return (
    <Surface className={cn('flex items-center gap-3 px-3.5 py-3', className)}>
      <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent">
        <Icon aria-hidden className="size-4.5" strokeWidth={1.8} />
      </span>

      <span className="min-w-0">
        <span className="block truncate text-xs text-ink-muted">{label}</span>
        <span className="block text-xl leading-tight font-semibold text-ink tabular-nums">
          {value}
        </span>
      </span>
    </Surface>
  )
}
