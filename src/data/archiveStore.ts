import { subscribeToStorageKeys } from '@/data/crossTabSync'
import { archiveRepository, type ArchiveRepository } from '@/data/archiveRepository'
import { noteRepository, type NoteRepository } from '@/data/noteRepository'
import { readStable } from '@/data/readStable'
import { STORAGE_KEYS } from '@/data/storageKeys'
import { snippetRepository, type SnippetRepository } from '@/data/snippetRepository'
import { taskStore, type TaskStore } from '@/data/taskStore'
import { archivedRecordId, type ArchivedItem } from '@/types/archive'
import type { Note } from '@/types/note'
import type { Snippet } from '@/types/snippet'
import type { Task } from '@/types/task'

/**
 * What a subscriber sees. A single immutable object so
 * `useSyncExternalStore` can compare snapshots by identity and only re-render
 * when something actually changed.
 */
export type ArchiveSnapshot = {
  items: readonly ArchivedItem[]
  isLoading: boolean
}

/**
 * The archive the whole application reads from.
 *
 * Archiving is not owned by the Archive page: it is triggered from the notes,
 * tasks and snippets workspaces, and it moves a record *out of* one store and
 * *into* another. A single module-level store is the only place that can keep
 * those two halves consistent and guarantee the move is safe, so every action
 * goes through it rather than each workspace reaching across to storage itself.
 *
 * Two invariants keep the data safe:
 *
 *  - **Nothing is ever removed before its replacement exists.** Archiving adds
 *    to the archive *first* and only then removes the active record; restoring
 *    writes the record back into its module before releasing the archive copy.
 *    A failure can therefore leave a duplicate, but never a gap.
 *  - **A move that cannot finish is rolled back.** If the active removal fails
 *    after the archive write, the archive entry is withdrawn again, so the item
 *    stays exactly where the user left it.
 */
export type ArchiveStore = {
  /** `useSyncExternalStore` contract: subscribe, and unsubscribe on return. */
  subscribe: (listener: () => void) => () => void
  /** `useSyncExternalStore` contract: a cached, referentially stable value. */
  getSnapshot: () => ArchiveSnapshot
  /** Moves a note out of the notes workspace and into the archive. */
  archiveNote: (note: Note) => Promise<boolean>
  /** Moves a task out of the tasks workspace and into the archive. */
  archiveTask: (task: Task) => Promise<boolean>
  /** Moves a snippet out of the snippets workspace and into the archive. */
  archiveSnippet: (snippet: Snippet) => Promise<boolean>
  /** Returns an archived record to the module it came from. */
  restore: (item: ArchivedItem) => Promise<boolean>
  /** Removes an archived record for good. The only irreversible action. */
  deleteForever: (item: ArchivedItem) => Promise<boolean>
  /**
   * Discards every archived record, in storage and in the shared snapshot, so
   * the Archive page empties immediately. Like the other mutations, nothing is
   * ever removed from an active module.
   */
  clear: () => Promise<boolean>
}

/**
 * Everything the store needs to move a record. Passed in rather than imported
 * directly so a SQLite-backed set can be dropped in without touching the store.
 */
export type ArchiveDependencies = {
  archive: ArchiveRepository
  notes: NoteRepository
  snippets: SnippetRepository
  tasks: TaskStore
}

const NO_ITEMS: readonly ArchivedItem[] = []

/** Builds a store over any set of repositories. */
export function createArchiveStore(dependencies: ArchiveDependencies): ArchiveStore {
  const { archive, notes, snippets, tasks } = dependencies

  let snapshot: ArchiveSnapshot = { items: NO_ITEMS, isLoading: true }

  const listeners = new Set<() => void>()
  let loadStarted = false
  // Bumped whenever a mutation changes the archive. `refresh` consults it so a
  // read that began before a mutation cannot overwrite the newer result.
  let revision = 0

  function emit(next: ArchiveSnapshot): void {
    snapshot = next

    for (const listener of listeners) {
      listener()
    }
  }

  /** Records that the archive changed, invalidating any read already in flight. */
  function markChanged(): void {
    revision += 1
  }

  /**
   * Re-reads the archive so the snapshot always mirrors what was stored.
   *
   * The read is retried if a move lands while it is in flight, so an archive,
   * restore or delete performed before the read resolves is not overwritten by
   * the stale result.
   */
  async function refresh(): Promise<void> {
    await readStable(
      () => archive.list(),
      () => revision,
      (items) => emit({ items, isLoading: false }),
    )
  }

  /**
   * Reads the archive once per session, triggered by the first subscriber. A
   * later subscriber joins the load already in flight rather than starting its
   * own.
   */
  function load(): void {
    if (loadStarted) {
      return
    }

    loadStarted = true

    refresh().catch(() => {
      // Storage unavailable: present an empty archive rather than failing.
      emit({ items: NO_ITEMS, isLoading: false })
    })
  }

  /** The detach for the cross-tab watcher, or `null` while nobody is listening. */
  let unsubscribeCrossTab: (() => void) | null = null

  /**
   * Folds in a change another tab wrote to the archive. `refresh` already reads
   * through `readStable`, so a move landing locally while this read is in flight
   * is not clobbered by the older stored result.
   */
  function refreshFromStorage(): void {
    refresh().catch(() => {
      // Storage unavailable: keep the current archive rather than blanking it.
    })
  }

  /**
   * Watches the archive key while the store has at least one subscriber, so a
   * store created in a test or a non-DOM process attaches nothing.
   */
  function watchCrossTab(): void {
    if (unsubscribeCrossTab) {
      return
    }

    unsubscribeCrossTab = subscribeToStorageKeys(
      [STORAGE_KEYS.archive],
      refreshFromStorage,
    )
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

    async archiveNote(note) {
      const entry: ArchivedItem = { type: 'note', archivedAt: Date.now(), note }

      try {
        await archive.add(entry)
      } catch {
        return false
      }

      try {
        await notes.remove(note.id)
      } catch {
        // The note is still in the notes workspace; take the archive copy back
        // so the failed move leaves no duplicate behind.
        await archive.remove('note', note.id).catch(() => undefined)
        return false
      }

      markChanged()
      await refresh()
      return true
    },

    async archiveTask(task) {
      const entry: ArchivedItem = { type: 'task', archivedAt: Date.now(), task }

      try {
        await archive.add(entry)
      } catch {
        return false
      }

      const removed = await tasks.deleteTask(task.id)

      if (!removed) {
        await archive.remove('task', task.id).catch(() => undefined)
        return false
      }

      markChanged()
      await refresh()
      return true
    },

    async archiveSnippet(snippet) {
      const entry: ArchivedItem = { type: 'snippet', archivedAt: Date.now(), snippet }

      try {
        await archive.add(entry)
      } catch {
        return false
      }

      try {
        await snippets.remove(snippet.id)
      } catch {
        await archive.remove('snippet', snippet.id).catch(() => undefined)
        return false
      }

      markChanged()
      await refresh()
      return true
    },

    async restore(item) {
      // Put the record back in its own module before releasing the archive copy,
      // so the item never exists in neither place.
      switch (item.type) {
        case 'note': {
          try {
            await notes.insert(item.note)
          } catch {
            return false
          }
          break
        }
        case 'task': {
          const restored = await tasks.restoreTask(item.task)

          if (!restored) {
            return false
          }
          break
        }
        case 'snippet': {
          try {
            await snippets.insert(item.snippet)
          } catch {
            return false
          }
          break
        }
      }

      try {
        await archive.remove(item.type, archivedRecordId(item))
      } catch {
        // The record is safely back in its module; leaving the archive copy is
        // a recoverable duplicate, not a loss.
        return false
      }

      markChanged()
      await refresh()
      return true
    },

    async deleteForever(item) {
      try {
        await archive.remove(item.type, archivedRecordId(item))
      } catch {
        return false
      }

      markChanged()
      await refresh()
      return true
    },

    async clear() {
      try {
        await archive.clear()
        markChanged()
        emit({ items: NO_ITEMS, isLoading: false })
        return true
      } catch {
        return false
      }
    },
  }
}

/** The store the application uses. */
export const archiveStore: ArchiveStore = createArchiveStore({
  archive: archiveRepository,
  notes: noteRepository,
  snippets: snippetRepository,
  tasks: taskStore,
})
