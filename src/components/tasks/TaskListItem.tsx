import { Archive, Trash2 } from 'lucide-react'

import { TaskCheckbox } from '@/components/tasks/TaskCheckbox'
import { TaskDueBadge } from '@/components/tasks/TaskDueBadge'
import { TaskPriorityBadge } from '@/components/tasks/TaskPriorityBadge'
import { IconButton } from '@/components/ui/IconButton'
import type { Task } from '@/types/task'
import { cn } from '@/utils/cn'
import { isOverdue } from '@/utils/task'

type TaskListItemProps = {
  task: Task
  /** Today as `YYYY-MM-DD`. */
  today: string
  onToggle: (task: Task, completed: boolean) => void
  onEdit: (task: Task) => void
  onArchive: (task: Task) => void
  onDelete: (task: Task) => void
}

/**
 * One row: the completion checkbox, the task itself, and its actions.
 *
 * The checkbox and the action buttons are siblings of the content button rather
 * than inside it — interactive controls may not nest, and separating them keeps
 * the accessible name of each one meaningful.
 */
export function TaskListItem({
  task,
  today,
  onToggle,
  onEdit,
  onArchive,
  onDelete,
}: TaskListItemProps) {
  const title = task.title.trim() || 'Untitled task'
  const description = task.description.replace(/\s+/g, ' ').trim()

  return (
    <li className="group flex items-center gap-1.5 rounded-sm px-2 py-1.5 transition-colors duration-150 ease-standard hover:bg-canvas focus-within:bg-canvas">
      <TaskCheckbox
        checked={task.completed}
        label={title}
        onChange={(completed) => onToggle(task, completed)}
      />

      <button
        type="button"
        onClick={() => onEdit(task)}
        className="min-w-0 flex-1 rounded-xs text-left"
      >
        <span
          className={cn(
            'block truncate text-sm',
            task.completed ? 'text-ink-muted line-through' : 'text-ink',
          )}
        >
          {title}
        </span>

        <span className="mt-1 flex items-center gap-1.5">
          {task.dueDate ? (
            <TaskDueBadge dueDate={task.dueDate} today={today} overdue={isOverdue(task, today)} />
          ) : null}
          <TaskPriorityBadge priority={task.priority} />
          {description ? (
            <span className="min-w-0 flex-1 truncate text-2xs text-ink-muted">{description}</span>
          ) : null}
        </span>
      </button>

      {/*
        Revealed on hover or when anything in the row has focus. `invisible`
        keeps them out of the tab order until then, at which point the row
        already has focus and the buttons become reachable.
      */}
      <IconButton
        icon={Archive}
        label={`Archive “${title}”`}
        onClick={() => onArchive(task)}
        className="invisible shrink-0 group-hover:visible group-focus-within:visible hover:bg-accent-soft hover:text-accent"
      />
      <IconButton
        icon={Trash2}
        label={`Delete “${title}”`}
        onClick={() => onDelete(task)}
        className="invisible shrink-0 group-hover:visible group-focus-within:visible hover:bg-danger-soft hover:text-danger"
      />
    </li>
  )
}
