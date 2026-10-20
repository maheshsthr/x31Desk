import { isDateValue } from '@/utils/date'

/** How urgent a task is, from least to most. */
export type TaskPriority = 'low' | 'medium' | 'high'

/** The priority a task gets when the user does not choose one. */
export const DEFAULT_TASK_PRIORITY: TaskPriority = 'medium'

/**
 * A single task.
 *
 * Timestamps are epoch milliseconds, exactly like notes, so they sort
 * numerically and survive a JSON round-trip unchanged. `dueDate` is
 * deliberately *not* one of them: a due date is a calendar day in the user's own
 * timezone, and storing it as an instant would let it drift across a date
 * boundary. It is kept as `YYYY-MM-DD`, or `null` for an unscheduled task.
 */
export type Task = {
  id: string
  title: string
  description: string
  /** Local calendar day (`YYYY-MM-DD`), or `null` when unscheduled. */
  dueDate: string | null
  priority: TaskPriority
  completed: boolean
  createdAt: number
  updatedAt: number
  /** When the task was last completed, or `null` while it is open. */
  completedAt: number | null
}

/** The part of a task the user edits; the store owns ids and timestamps. */
export type TaskDraft = {
  title: string
  description: string
  dueDate: string | null
  priority: TaskPriority
}

/** The draft a new task starts from, so every "New task" opens the same way. */
export const EMPTY_TASK_DRAFT: TaskDraft = {
  title: '',
  description: '',
  dueDate: null,
  priority: DEFAULT_TASK_PRIORITY,
}

/** Validates a priority read from storage. */
export function isTaskPriority(value: unknown): value is TaskPriority {
  return value === 'low' || value === 'medium' || value === 'high'
}

/**
 * Validates one entry read from storage. Anything that does not match is
 * discarded rather than trusted, so a hand-edited or truncated payload can
 * never reach the task list as a half-formed task.
 */
export function isTask(value: unknown): value is Task {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate: Record<string, unknown> = value as Record<string, unknown>

  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.title === 'string' &&
    typeof candidate.description === 'string' &&
    (candidate.dueDate === null ||
      (typeof candidate.dueDate === 'string' && isDateValue(candidate.dueDate))) &&
    isTaskPriority(candidate.priority) &&
    typeof candidate.completed === 'boolean' &&
    typeof candidate.createdAt === 'number' &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.updatedAt === 'number' &&
    Number.isFinite(candidate.updatedAt) &&
    (candidate.completedAt === null ||
      (typeof candidate.completedAt === 'number' && Number.isFinite(candidate.completedAt)))
  )
}
