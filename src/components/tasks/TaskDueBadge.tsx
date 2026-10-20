import { CalendarClock } from 'lucide-react'

import { cn } from '@/utils/cn'
import { formatDueDate, formatLongDate } from '@/utils/date'

type TaskDueBadgeProps = {
  /** `YYYY-MM-DD` in the local calendar. */
  dueDate: string
  /** Today as `YYYY-MM-DD`, used for the relative label and "due today" tint. */
  today: string
  /** Whether the owning task is overdue; only ever true for an open task. */
  overdue: boolean
  className?: string
}

function toneClasses(overdue: boolean, isToday: boolean): string {
  if (overdue) {
    return 'bg-danger-soft text-danger'
  }

  if (isToday) {
    return 'bg-accent-soft text-accent'
  }

  return 'bg-canvas text-ink-muted'
}

/** Compact due-date chip: `Today` / `Tomorrow` / `Yesterday` / `Oct 14`. */
export function TaskDueBadge({ dueDate, today, overdue, className }: TaskDueBadgeProps) {
  return (
    <span
      title={formatLongDate(dueDate)}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-xs px-1.5 text-2xs font-medium',
        toneClasses(overdue, dueDate === today),
        className,
      )}
    >
      <CalendarClock aria-hidden strokeWidth={2} className="size-3 shrink-0" />
      <span className="sr-only">{overdue ? 'Overdue, due ' : 'Due '}</span>
      {formatDueDate(dueDate, today)}
    </span>
  )
}
