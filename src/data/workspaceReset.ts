import { archiveStore } from '@/data/archiveStore'
import { noteRepository } from '@/data/noteRepository'
import { saveQueue } from '@/data/saveQueue'
import { snippetRepository } from '@/data/snippetRepository'
import { taskStore } from '@/data/taskStore'

/** Runs one clear step, reporting whether it finished without throwing. */
async function run(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action()
    return true
  } catch {
    return false
  }
}

/**
 * Wipes every workspace collection — notes, tasks, snippets and the archive —
 * in one step.
 *
 * The tasks and archive stores are cleared *through* their stores, not their
 * repositories, so their in-memory snapshots empty at the same moment and the
 * dashboard and Archive page update without a reload. Notes and snippets keep
 * no module-level state (their hooks reload on mount), so clearing their
 * repositories is enough.
 *
 * Any debounced edit still waiting in the save queue is dropped and any write
 * already in flight is awaited *before* the collections are cleared, so nothing
 * can be written back a moment after the reset and resurrect a record the user
 * just asked to be gone. The queue is drained rather than merely cancelled
 * because a cancelled write cannot undo a write already in progress; awaiting
 * it first guarantees the reset is the last thing to touch storage.
 *
 * Preferences are deliberately untouched: the theme and editor keys
 * are not reachable from here, so "clear workspace data" can never reset a setting.
 * Resolves `true` only when every collection was cleared.
 */
export async function clearWorkspaceData(): Promise<boolean> {
  saveQueue.cancelAll()

  // A failed pending write is already reported; the reset is the user's intent,
  // so it proceeds regardless.
  await saveQueue.flushAll().catch(() => undefined)

  const results = await Promise.all([
    run(() => noteRepository.clear()),
    run(() => snippetRepository.clear()),
    run(() => taskStore.clear()),
    run(() => archiveStore.clear()),
  ])

  return results.every(Boolean)
}
