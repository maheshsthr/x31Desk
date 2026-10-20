import type { ReactNode } from 'react'

import { TaskListItem } from '@/components/tasks/TaskListItem'
import { Surface } from '@/components/ui/Surface'
import type { Task } from '@/types/task'
import { cn } from '@/utils/cn'

type TaskListProps = {
  /** Tasks after the active view and search have been applied. */
  tasks: readonly Task[]
  /** Today as `YYYY-MM-DD`, passed down for due-date labels. */
  today: string
  /** Rendered instead of the rows when the active filter matches nothing. */
  empty: ReactNode
  onToggle: (task: Task, completed: boolean) => void
  onEdit: (task: Task) => void
  onArchive: (task: Task) => void
  onDelete: (task: Task) => void
  className?: string
}

/**
 * The list surface: a scrolling column of rows, or the empty state for the
 * filter that produced no rows. Scrolls on its own so the toolbar above it
 * stays put.
 */
export function TaskList({
  tasks,
  today,
  empty,
  onToggle,
  onEdit,
  onArchive,
  onDelete,
  className,
}: TaskListProps) {
  return (
    <Surface className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {tasks.length === 0 ? (
        empty
      ) : (
        <ul aria-label="Tasks" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
          {tasks.map((task) => (
            <TaskListItem
              key={task.id}
              task={task}
              today={today}
              onToggle={onToggle}
              onEdit={onEdit}
              onArchive={onArchive}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </Surface>
  )
}
