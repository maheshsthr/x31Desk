/**
 * x31Desk — the SQLite-backed task repository.
 * ---------------------------------------------------------------------------
 * Implements the same `TaskRepository` interface the `localStorage` adapter
 * does. A task's `completed` flag is stored as the `0`/`1` the schema's `CHECK`
 * constraint requires and read back as a boolean; `dueDate` stays a `YYYY-MM-DD`
 * string or `NULL`, never an instant, so a calendar day cannot drift across a
 * timezone boundary.
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import type { TaskRepository } from '@/data/repositoryTypes'
import { DEFAULT_TASK_PRIORITY, isTaskPriority, type Task, type TaskPriority } from '@/types/task'

import {
  asRow,
  asRows,
  readBoolean,
  readNullableNumber,
  readNullableString,
  readNumber,
  readString,
  toBinding,
} from '../rows.ts'
import { runInTransaction } from '../transaction.ts'

const COLUMNS =
  'id, title, description, due_date, priority, completed, created_at, updated_at, completed_at'

/** Reads a priority column, falling back to the default for an unknown value. */
function readPriority(row: Record<string, unknown>): TaskPriority {
  const value = row.priority

  return isTaskPriority(value) ? value : DEFAULT_TASK_PRIORITY
}

/**
 * Converts one `tasks` row to a {@link Task}.
 *
 * Exported so the one-time `localStorage` import reads a row through the same
 * mapping the repository uses, rather than a second copy that could drift.
 */
export function toTask(row: Record<string, unknown>): Task {
  return {
    id: readString(row, 'id'),
    title: readString(row, 'title'),
    description: readString(row, 'description'),
    dueDate: readNullableString(row, 'due_date'),
    priority: readPriority(row),
    completed: readBoolean(row, 'completed'),
    createdAt: readNumber(row, 'created_at'),
    updatedAt: readNumber(row, 'updated_at'),
    completedAt: readNullableNumber(row, 'completed_at'),
  }
}

/**
 * The SQLite-backed tasks store.
 *
 * `update` and `setCompleted` read the row before writing it — the first to
 * preserve completion state, the second to preserve the rest of the record — so
 * both run in a transaction. Completion also stamps `completedAt`, exactly as
 * the `localStorage` adapter does.
 */
export function createSqliteTaskRepository(database: DatabaseSync): TaskRepository {
  const selectAll = database.prepare(`SELECT ${COLUMNS} FROM tasks ORDER BY rowid`)
  const selectOne = database.prepare(`SELECT ${COLUMNS} FROM tasks WHERE id = ?`)
  const upsert = database.prepare(`
    INSERT INTO tasks
      (id, title, description, due_date, priority, completed, created_at, updated_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      due_date = excluded.due_date,
      priority = excluded.priority,
      completed = excluded.completed,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at
  `)
  const updateOne = database.prepare(
    'UPDATE tasks SET title = ?, description = ?, due_date = ?, priority = ?, updated_at = ? WHERE id = ?',
  )
  const setCompleted = database.prepare(
    'UPDATE tasks SET completed = ?, completed_at = ?, updated_at = ? WHERE id = ?',
  )
  const deleteOne = database.prepare('DELETE FROM tasks WHERE id = ?')
  const deleteAll = database.prepare('DELETE FROM tasks')

  function readOne(id: string): Task | null {
    const row = asRow(selectOne.get(id))

    return row === null ? null : toTask(row)
  }

  return {
    async list() {
      return asRows(selectAll.all()).map(toTask)
    },

    async create(draft) {
      const now = Date.now()
      const task: Task = {
        id: randomUUID(),
        title: draft.title,
        description: draft.description,
        dueDate: draft.dueDate,
        priority: draft.priority,
        completed: false,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      }

      upsert.run(
        task.id,
        task.title,
        task.description,
        task.dueDate,
        task.priority,
        toBinding(task.completed),
        task.createdAt,
        task.updatedAt,
        task.completedAt,
      )

      return task
    },

    async update(id, draft) {
      return runInTransaction(database, () => {
        const existing = readOne(id)

        if (existing === null) {
          return null
        }

        const updatedAt = Date.now()
        updateOne.run(draft.title, draft.description, draft.dueDate, draft.priority, updatedAt, id)

        return {
          ...existing,
          title: draft.title,
          description: draft.description,
          dueDate: draft.dueDate,
          priority: draft.priority,
          updatedAt,
        }
      })
    },

    async setCompleted(id, completed) {
      return runInTransaction(database, () => {
        const existing = readOne(id)

        if (existing === null) {
          return null
        }

        const now = Date.now()
        const completedAt = completed ? now : null

        setCompleted.run(toBinding(completed), completedAt, now, id)

        return { ...existing, completed, completedAt, updatedAt: now }
      })
    },

    async insert(task) {
      upsert.run(
        task.id,
        task.title,
        task.description,
        task.dueDate,
        task.priority,
        toBinding(task.completed),
        task.createdAt,
        task.updatedAt,
        task.completedAt,
      )

      return task
    },

    async remove(id) {
      deleteOne.run(id)
    },

    async clear() {
      deleteAll.run()
    },
  }
}
