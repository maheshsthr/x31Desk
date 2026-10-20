import { useSyncExternalStore } from 'react'

import { archiveStore } from '@/data/archiveStore'
import { taskStore } from '@/data/taskStore'

/**
 * The tasks workspace API: the shared collection plus every mutation.
 *
 * Thin on purpose. All of the state and persistence live in the store, so the
 * workspace and the dashboard observe the same tasks and can never hold
 * divergent copies — completing a task in one updates the other immediately.
 */
export function useTasks() {
  const snapshot = useSyncExternalStore(taskStore.subscribe, taskStore.getSnapshot)

  return {
    tasks: snapshot.tasks,
    isLoading: snapshot.isLoading,
    createTask: taskStore.createTask,
    updateTask: taskStore.updateTask,
    setTaskCompleted: taskStore.setTaskCompleted,
    deleteTask: taskStore.deleteTask,
    archiveTask: archiveStore.archiveTask,
  }
}
