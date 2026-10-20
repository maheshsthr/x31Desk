import { preserveUnreadable, QUARANTINE_KEYS } from '@/data/quarantine'
import type { TaskRepository } from '@/data/repositoryTypes'
import { runStorageOperation, runStorageRead } from '@/data/storageError'
import { STORAGE_KEYS } from '@/data/storageKeys'
import { isTask, type Task, type TaskDraft } from '@/types/task'
import { createId } from '@/utils/id'

/**
 * The task store the interface talks to, defined in `repositoryTypes.ts` so the
 * SQLite adapter can share it without pulling `localStorage` into the main
 * process. Re-exported here so existing importers are unaffected.
 */
export type { TaskRepository }

const STORAGE_KEY = STORAGE_KEYS.tasks
const QUARANTINE_KEY = QUARANTINE_KEYS.tasks

/**
 * Preserves a payload we could not fully understand instead of destroying it.
 * Delegates to the shared helper so the write-once policy and the key itself
 * live in one place; see `quarantine.ts`.
 */
function quarantine(raw: string): void {
  preserveUnreadable(QUARANTINE_KEY, raw)
}

/**
 * Reads the whole collection defensively.
 *
 * Missing, empty, malformed or partially invalid data all resolve to a usable
 * array — the tasks workspace must never fail to open because of its own
 * storage.
 */
function readTasks(): Task[] {
  // Storage being disabled (private mode, hardened browser) behaves as empty.
  const raw = runStorageRead(() => window.localStorage.getItem(STORAGE_KEY), null)

  if (raw === null || raw === '') {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    quarantine(raw)
    return []
  }

  if (!Array.isArray(parsed)) {
    quarantine(raw)
    return []
  }

  const tasks = parsed.filter(isTask)

  // Keep the original bytes whenever entries had to be dropped, so nothing the
  // user wrote disappears without a trace.
  if (tasks.length !== parsed.length) {
    quarantine(raw)
  }

  return tasks
}

function writeTasks(tasks: readonly Task[]): void {
  runStorageOperation(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  })
}

/**
 * The localStorage-backed repository.
 *
 * Each mutation re-reads the stored collection and writes it back in a single
 * synchronous burst before the returned promise settles, matching the notes
 * repository. That keeps concurrent edits from clobbering one another and means
 * a write is already durable by the time the promise resolves.
 */
export function createLocalTaskRepository(): TaskRepository {
  return {
    async list() {
      return readTasks()
    },

    async create(draft) {
      const now = Date.now()
      const task: Task = {
        id: createId(),
        title: draft.title,
        description: draft.description,
        dueDate: draft.dueDate,
        priority: draft.priority,
        completed: false,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      }

      writeTasks([...readTasks(), task])

      return task
    },

    async update(id, draft) {
      const tasks = readTasks()
      const existing = tasks.find((task) => task.id === id)

      if (!existing) {
        return null
      }

      const updated: Task = {
        ...existing,
        title: draft.title,
        description: draft.description,
        dueDate: draft.dueDate,
        priority: draft.priority,
        updatedAt: Date.now(),
      }

      writeTasks(tasks.map((task) => (task.id === id ? updated : task)))

      return updated
    },

    async setCompleted(id, completed) {
      const tasks = readTasks()
      const existing = tasks.find((task) => task.id === id)

      if (!existing) {
        return null
      }

      const now = Date.now()
      const updated: Task = {
        ...existing,
        completed,
        completedAt: completed ? now : null,
        updatedAt: now,
      }

      writeTasks(tasks.map((task) => (task.id === id ? updated : task)))

      return updated
    },

    async insert(task) {
      const tasks = readTasks()
      const index = tasks.findIndex((candidate) => candidate.id === task.id)

      if (index === -1) {
        writeTasks([...tasks, task])
      } else {
        const next = [...tasks]
        next[index] = task
        writeTasks(next)
      }

      return task
    },

    async remove(id) {
      writeTasks(readTasks().filter((task) => task.id !== id))
    },

    async clear() {
      runStorageOperation(() => {
        window.localStorage.removeItem(STORAGE_KEY)
        window.localStorage.removeItem(QUARANTINE_KEY)
      })
    },
  }
}

/**
 * The active task store. It starts as the in-browser `localStorage` one — so
 * the web build and a plain browser are completely unchanged — and the desktop
 * shell rebinds it to the SQLite store in the main process, once, before the
 * workspace is first read (see `src/data/desktopStorage.ts`).
 */
let activeTaskRepository: TaskRepository = createLocalTaskRepository()

/** Points the task store at another implementation. See `bindNoteRepository`. */
export function bindTaskRepository(repository: TaskRepository): void {
  activeTaskRepository = repository
}

/** Returns the task store to the in-browser implementation. Used by tests. */
export function resetTaskRepository(): void {
  activeTaskRepository = createLocalTaskRepository()
}

/**
 * The repository the application uses.
 *
 * Every call is forwarded to whichever implementation is currently bound, so a
 * consumer — which imports this one stable object — keeps working whether the
 * data lives in `localStorage` or in the main process.
 */
export const taskRepository: TaskRepository = {
  list: () => activeTaskRepository.list(),
  create: (draft: TaskDraft) => activeTaskRepository.create(draft),
  update: (id: string, draft: TaskDraft) => activeTaskRepository.update(id, draft),
  setCompleted: (id: string, completed: boolean) => activeTaskRepository.setCompleted(id, completed),
  insert: (task: Task) => activeTaskRepository.insert(task),
  remove: (id: string) => activeTaskRepository.remove(id),
  clear: () => activeTaskRepository.clear(),
}
