import { subscribeToStorageKeys } from '@/data/crossTabSync'
import { readStable } from '@/data/readStable'
import { STORAGE_KEYS } from '@/data/storageKeys'
import { taskRepository, type TaskRepository } from '@/data/taskRepository'
import type { Task, TaskDraft } from '@/types/task'

/**
 * What a subscriber sees. A single immutable object so
 * `useSyncExternalStore` can compare snapshots by identity and only re-render
 * when something actually changed.
 */
export type TaskSnapshot = {
  tasks: readonly Task[]
  isLoading: boolean
}

/**
 * The tasks the whole application reads from.
 *
 * Notes are owned by the view that shows them (`useNotes`); tasks cannot be,
 * because the dashboard and the workspace both report on the same collection
 * and the requirement is that they update the moment a task changes. A single
 * module-level store gives every subscriber one shared source of truth — the
 * dashboard and the Tasks page can never hold divergent copies, and completing
 * a task from one updates the other immediately without a refetch.
 *
 * Mutations are applied optimistically after the repository resolves. Because
 * the localStorage adapter completes synchronously inside its promise, that is
 * the same frame as far as the user is concerned, and it avoids the rollback
 * bookkeeping a purely optimistic update would need.
 */
export type TaskStore = {
  /** `useSyncExternalStore` contract: subscribe, and unsubscribe on return. */
  subscribe: (listener: () => void) => () => void
  /** `useSyncExternalStore` contract: a cached, referentially stable value. */
  getSnapshot: () => TaskSnapshot
  createTask: (draft: TaskDraft) => Promise<Task | null>
  updateTask: (id: string, draft: TaskDraft) => Promise<Task | null>
  setTaskCompleted: (id: string, completed: boolean) => Promise<Task | null>
  deleteTask: (id: string) => Promise<boolean>
  /**
   * Puts an archived task back into the shared collection, exactly as it was.
   *
   * Restoring has to go through the store rather than the repository, because
   * the store loads storage once per session: a restored task would otherwise
   * be written to disk but remain invisible to the dashboard and the tasks
   * workspace until the next reload.
   */
  restoreTask: (task: Task) => Promise<Task | null>
  /**
   * Discards every task, in storage and in the shared snapshot, so the
   * dashboard and the workspace both drop them immediately.
   */
  clear: () => Promise<boolean>
}

const NO_TASKS: readonly Task[] = []

/** Builds a store over any repository, so a SQLite one can be dropped in. */
export function createTaskStore(repository: TaskRepository): TaskStore {
  let snapshot: TaskSnapshot = { tasks: NO_TASKS, isLoading: true }

  const listeners = new Set<() => void>()
  let loadStarted = false
  // Bumped after every mutation that changes the snapshot. The initial load
  // consults it so a read that started before a mutation cannot overwrite the
  // mutation's (newer) in-memory result.
  let revision = 0

  function emit(next: TaskSnapshot): void {
    snapshot = next

    for (const listener of listeners) {
      listener()
    }
  }

  /** Publishes a mutation result and records that the snapshot changed. */
  function commit(next: TaskSnapshot): void {
    revision += 1
    emit(next)
  }

  /**
   * Reads storage once per session, triggered by the first subscriber. A later
   * subscriber joins the load already in flight rather than starting its own.
   *
   * The read is retried if a mutation lands while it is in flight, so a task
   * created, edited or deleted before the first load resolves is never dropped
   * by the stale result.
   */
  function load(): void {
    if (loadStarted) {
      return
    }

    loadStarted = true

    readStable(
      () => repository.list(),
      () => revision,
      (tasks) => emit({ tasks, isLoading: false }),
    ).catch(() => {
      // Storage unavailable: present an empty workspace rather than failing.
      emit({ tasks: NO_TASKS, isLoading: false })
    })
  }

  /** The detach for the cross-tab watcher, or `null` while nobody is listening. */
  let unsubscribeCrossTab: (() => void) | null = null

  /**
   * Folds in a change another tab wrote to the tasks collection.
   *
   * The read runs through `readStable`, so a local mutation that lands while it
   * is in flight is never clobbered by the older stored result — exactly as the
   * initial load is guarded.
   */
  function refreshFromStorage(): void {
    readStable(
      () => repository.list(),
      () => revision,
      (tasks) => emit({ tasks, isLoading: false }),
    ).catch(() => {
      // Storage unavailable: keep the current snapshot rather than blanking it.
    })
  }

  /**
   * Watches the tasks key while the store has at least one subscriber, so a
   * store created in a test or a non-DOM process attaches nothing.
   */
  function watchCrossTab(): void {
    if (unsubscribeCrossTab) {
      return
    }

    unsubscribeCrossTab = subscribeToStorageKeys([STORAGE_KEYS.tasks], refreshFromStorage)
  }

  function replace(task: Task): void {
    commit({
      ...snapshot,
      tasks: snapshot.tasks.map((candidate) => (candidate.id === task.id ? task : candidate)),
    })
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      load()
      watchCrossTab()

      return () => {
        listeners.delete(listener)

        if (listeners.size === 0) {
          unsubscribeCrossTab?.()
          unsubscribeCrossTab = null
        }
      }
    },

    getSnapshot() {
      return snapshot
    },

    async createTask(draft) {
      try {
        const task = await repository.create(draft)
        commit({ ...snapshot, tasks: [task, ...snapshot.tasks] })
        return task
      } catch {
        return null
      }
    },

    async updateTask(id, draft) {
      try {
        const task = await repository.update(id, draft)

        if (task) {
          replace(task)
        }

        return task
      } catch {
        return null
      }
    },

    async setTaskCompleted(id, completed) {
      try {
        const task = await repository.setCompleted(id, completed)

        if (task) {
          replace(task)
        }

        return task
      } catch {
        return null
      }
    },

    async deleteTask(id) {
      try {
        await repository.remove(id)
        commit({ ...snapshot, tasks: snapshot.tasks.filter((task) => task.id !== id) })
        return true
      } catch {
        return false
      }
    },

    async restoreTask(task) {
      try {
        await repository.insert(task)

        const exists = snapshot.tasks.some((candidate) => candidate.id === task.id)

        commit({
          ...snapshot,
          tasks: exists
            ? snapshot.tasks.map((candidate) => (candidate.id === task.id ? task : candidate))
            : [task, ...snapshot.tasks],
        })

        return task
      } catch {
        return null
      }
    },

    async clear() {
      try {
        await repository.clear()
        commit({ tasks: NO_TASKS, isLoading: false })
        return true
      } catch {
        return false
      }
    },
  }
}

/** The store the application uses. */
export const taskStore: TaskStore = createTaskStore(taskRepository)
