import type { Task, TaskPriority } from '@/types/task'

/** Which slice of the collection the tasks workspace is showing. */
export type TaskView = 'all' | 'today' | 'upcoming' | 'completed'

/** Filter tabs, in presentation order. */
export const TASK_VIEWS: readonly { readonly id: TaskView; readonly label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Completed' },
]

/** Display names for the priority levels. */
export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

/** Priority options for the editor, least urgent first. */
export const PRIORITY_OPTIONS: readonly { readonly value: TaskPriority; readonly label: string }[] = [
  { value: 'low', label: PRIORITY_LABELS.low },
  { value: 'medium', label: PRIORITY_LABELS.medium },
  { value: 'high', label: PRIORITY_LABELS.high },
]

/** Sort weight for priorities: high sorts first. */
const PRIORITY_WEIGHT: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }

/**
 * `YYYY-MM-DD` values compare correctly as strings, so the ordering below never
 * has to build a `Date`. Undated tasks sort last because there is nothing to
 * order them by that the user has expressed.
 */
function compareDueDates(a: string | null, b: string | null): number {
  if (a === b) {
    return 0
  }

  if (a === null) {
    return 1
  }

  if (b === null) {
    return -1
  }

  return a < b ? -1 : 1
}

/**
 * Order for open tasks: soonest due date first (undated last), then by
 * priority, then oldest first — so a list built up over time keeps its shape
 * instead of shuffling whenever something is typed.
 */
export function compareOpenTasks(a: Task, b: Task): number {
  const byDueDate = compareDueDates(a.dueDate, b.dueDate)

  if (byDueDate !== 0) {
    return byDueDate
  }

  const byPriority = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]

  if (byPriority !== 0) {
    return byPriority
  }

  return a.createdAt - b.createdAt
}

/** Completed tasks: most recently ticked off first. */
export function compareCompletedTasks(a: Task, b: Task): number {
  return (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt)
}

/** True when an open task was due before today. */
export function isOverdue(task: Task, today: string): boolean {
  return !task.completed && task.dueDate !== null && task.dueDate < today
}

/**
 * True when an open task is due today. Used by the dashboard, which reports
 * exactly what its label says.
 */
export function isDueToday(task: Task, today: string): boolean {
  return !task.completed && task.dueDate === today
}

/**
 * Whether a task belongs to a view.
 *
 * `today` deliberately includes overdue work: a list that hides a task because
 * it slipped past midnight is a list that hides the thing most worth doing.
 */
function belongsToView(task: Task, view: TaskView, today: string): boolean {
  switch (view) {
    case 'all':
      return !task.completed
    case 'today':
      return !task.completed && task.dueDate !== null && task.dueDate <= today
    case 'upcoming':
      return !task.completed && task.dueDate !== null && task.dueDate > today
    case 'completed':
      return task.completed
  }
}

/** How many tasks each filter tab would show. */
export function taskViewCounts(tasks: readonly Task[], today: string): Record<TaskView, number> {
  const counts: Record<TaskView, number> = { all: 0, today: 0, upcoming: 0, completed: 0 }

  for (const task of tasks) {
    for (const view of TASK_VIEWS) {
      if (belongsToView(task, view.id, today)) {
        counts[view.id] += 1
      }
    }
  }

  return counts
}

/**
 * The tasks to render for one view, filtered by a title search and in display
 * order. Returns a fresh array, so callers can sort or slice it freely.
 */
export function selectTasks(
  tasks: readonly Task[],
  view: TaskView,
  query: string,
  today: string,
): Task[] {
  const needle = query.trim().toLowerCase()
  const selected: Task[] = []

  for (const task of tasks) {
    if (!belongsToView(task, view, today)) {
      continue
    }

    if (needle !== '' && !task.title.toLowerCase().includes(needle)) {
      continue
    }

    selected.push(task)
  }

  return selected.sort(view === 'completed' ? compareCompletedTasks : compareOpenTasks)
}
