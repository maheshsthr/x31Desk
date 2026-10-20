import type { TaskPriority } from '@/types/task'
import { cn } from '@/utils/cn'
import { PRIORITY_LABELS } from '@/utils/task'

type TaskPriorityBadgeProps = {
  priority: TaskPriority
  className?: string
}

/** Soft tint per level: red reads as urgent, amber as moderate, grey as low. */
const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  high: 'bg-danger-soft text-danger',
  medium: 'bg-warning-soft text-warning',
  low: 'bg-canvas text-ink-muted',
}

/**
 * Compact priority chip. The level is spelled out rather than only colour-coded,
 * so it is legible without relying on colour perception.
 */
export function TaskPriorityBadge({ priority, className }: TaskPriorityBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-xs px-1.5 text-2xs font-medium',
        PRIORITY_CLASSES[priority],
        className,
      )}
    >
      <span className="sr-only">Priority: </span>
      {PRIORITY_LABELS[priority]}
    </span>
  )
}
