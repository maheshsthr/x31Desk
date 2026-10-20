/**
 * x31Desk — the IPC-backed task repository.
 * ---------------------------------------------------------------------------
 * Implements `TaskRepository` over the preload bridge, so the tasks workspace
 * runs against the SQLite store in the main process once the desktop shell binds
 * it (see `src/data/desktopStorage.ts`).
 *
 * `setCompleted` forwards the flag as a boolean and the main process stores it as
 * the `0`/`1` the schema requires.
 */

import { unwrapIpcResult } from '@/data/ipc/unwrap'
import type { TaskRepository } from '@/data/repositoryTypes'
import type { DesktopTaskBridge } from '@/types/desktop'
import type { Task, TaskDraft } from '@/types/task'

/** The task repository backed by the main process. */
export function createIpcTaskRepository(tasks: DesktopTaskBridge): TaskRepository {
  return {
    async list() {
      return unwrapIpcResult(await tasks.list())
    },

    async create(draft: TaskDraft) {
      return unwrapIpcResult(await tasks.create({ draft }))
    },

    async update(id: string, draft: TaskDraft) {
      return unwrapIpcResult(await tasks.update({ id, draft }))
    },

    async setCompleted(id: string, completed: boolean) {
      return unwrapIpcResult(await tasks.setCompleted({ id, completed }))
    },

    async insert(task: Task) {
      return unwrapIpcResult(await tasks.insert({ task }))
    },

    async remove(id: string) {
      unwrapIpcResult(await tasks.remove({ id }))
    },

    async clear() {
      unwrapIpcResult(await tasks.clear())
    },
  }
}
