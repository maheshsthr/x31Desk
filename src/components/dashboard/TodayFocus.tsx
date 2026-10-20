import { CalendarCheck } from 'lucide-react'

import { TaskCheckbox } from '@/components/tasks/TaskCheckbox'
import { TaskDueBadge } from '@/components/tasks/TaskDueBadge'
import { TaskPriorityBadge } from '@/components/tasks/TaskPriorityBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Task } from '@/types/task'
import { isOverdue } from '@/utils/task'

type TodayFocusProps = {
  /** Today's tasks, already capped by the caller. */
  tasks: readonly Task[]
  /** How many more are due today beyond `tasks`. */
  overflow: number
  /** Today as `YYYY-MM-DD`. */
  today: string
  isLoading: boolean
  onToggle: (task: Task, completed: boolean) => void
  onOpenTasks: () => void
}

/**
 * The body of the dashboard's "Today's focus" section.
 *
 * Rows are checkable in place, which is the whole point of surfacing them here:
 * ticking one off updates the overview counts beside it on the same frame,
 * because both read the same store.
 */
export function TodayFocus({
  tasks,
  overflow,
  today,
  isLoading,
  onToggle,
  onOpenTasks,
}: TodayFocusProps) {
  if (isLoading) {
    return <p className="text-xs text-ink-muted">Loading tasks…</p>
  }

  if (tasks.length === 0) {
    return (
      <EmptyState
        variant="inline"
        icon={CalendarCheck}
        title="Nothing due today."
        description="Tasks due today — and anything overdue — will appear here."
      />
    )
  }

  return (
    <div className="flex flex-col">
      <ul className="space-y-0.5">
        {tasks.map((task) => {
          const title = task.title.trim() || 'Untitled task'

          return (
            <li key={task.id} className="flex items-center gap-2">
              <TaskCheckbox
                checked={task.completed}
                label={title}
                onChange={(completed) => onToggle(task, completed)}
              />
              <button
                type="button"
                onClick={onOpenTasks}
                className="min-w-0 flex-1 truncate rounded-xs text-left text-sm text-ink transition-colors duration-150 ease-standard hover:text-accent"
              >
                {title}
              </button>
              {task.dueDate && isOverdue(task, today) ? (
                <TaskDueBadge dueDate={task.dueDate} today={today} overdue />
              ) : null}
              <TaskPriorityBadge priority={task.priority} />
            </li>
          )
        })}
      </ul>

      {overflow > 0 ? (
        <p className="mt-2 text-2xs text-ink-muted">and {overflow} more</p>
      ) : null}
    </div>
  )
}
