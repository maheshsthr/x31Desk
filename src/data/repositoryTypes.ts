/**
 * x31Desk — the workspace store contracts.
 * ---------------------------------------------------------------------------
 * The four repositories the application is written against. They are declared
 * here, apart from any implementation, for one reason: the *interface* is
 * backend-agnostic and the main process needs it too, while the `localStorage`
 * implementations in `noteRepository.ts` and friends touch `window` and are
 * renderer-only. Keeping the contracts in a DOM-free module is what lets the
 * SQLite adapters in `electron/db/repositories/` be typed by the very interface
 * the renderer is written against.
 *
 * Each implementation module re-exports its type, so every existing import of
 * `NoteRepository` (and the rest) from `@/data/*Repository` keeps working.
 *
 * Every method is asynchronous even though the `localStorage` implementations
 * resolve almost immediately: the interface is the shape the SQLite adapter
 * (reached over IPC in the Electron shell) actually has, so the UI is written
 * against the contract it will have rather than the convenience of synchronous
 * storage. Ordering is a presentation concern throughout — the UI sorts — so a
 * `list` never promises an order.
 */

import type { ArchiveItemType, ArchivedItem } from '@/types/archive'
import type { Note, NoteDraft } from '@/types/note'
import type { Snippet, SnippetDraft } from '@/types/snippet'
import type { Task, TaskDraft } from '@/types/task'

/** The note store the interface talks to. */
export type NoteRepository = {
  /** Every stored note. Ordering is a presentation concern; the UI sorts. */
  list: () => Promise<Note[]>
  /** Creates an empty note and returns it. */
  create: () => Promise<Note>
  /** Applies an edit. Resolves with the stored note, or `null` if it is gone. */
  update: (id: string, draft: NoteDraft) => Promise<Note | null>
  /**
   * Writes a complete note as-is, preserving its id and timestamps.
   *
   * Unlike `create` this does not mint an id: it stores exactly the record it
   * is given. It is what a restore uses to put a note back as it was, and it
   * upserts by id, so restoring the same note twice cannot duplicate it.
   */
  insert: (note: Note) => Promise<Note>
  /** Removes a note. Resolving is not an error when it was already absent. */
  remove: (id: string) => Promise<void>
  /**
   * Discards every note. Also drops any quarantined payload, since a reset is
   * the one moment the user has asked for that data to be gone for good.
   */
  clear: () => Promise<void>
}

/** The task store the interface talks to. */
export type TaskRepository = {
  /** Every stored task. Ordering is a presentation concern; the UI sorts. */
  list: () => Promise<Task[]>
  /** Creates a task from a draft and returns the stored record. */
  create: (draft: TaskDraft) => Promise<Task>
  /** Applies an edit. Resolves with the stored task, or `null` if it is gone. */
  update: (id: string, draft: TaskDraft) => Promise<Task | null>
  /** Ticks a task off or reopens it. Resolves with `null` if it is gone. */
  setCompleted: (id: string, completed: boolean) => Promise<Task | null>
  /**
   * Writes a complete task as-is, preserving its id and timestamps.
   *
   * Unlike `create` this does not mint an id: it stores exactly the record it
   * is given. It is what a restore uses to put a task back as it was, and it
   * upserts by id, so restoring the same task twice cannot duplicate it.
   */
  insert: (task: Task) => Promise<Task>
  /** Removes a task. Resolving is not an error when it was already absent. */
  remove: (id: string) => Promise<void>
  /**
   * Discards every task. Also drops any quarantined payload, since a reset is
   * the one moment the user has asked for that data to be gone for good.
   */
  clear: () => Promise<void>
}

/** The snippet store the interface talks to. */
export type SnippetRepository = {
  /** Every stored snippet. Ordering is a presentation concern; the UI sorts. */
  list: () => Promise<Snippet[]>
  /** Creates a snippet from a draft and returns the stored record. */
  create: (draft: SnippetDraft) => Promise<Snippet>
  /** Applies an edit. Resolves with the stored snippet, or `null` if it is gone. */
  update: (id: string, draft: SnippetDraft) => Promise<Snippet | null>
  /**
   * Writes a complete snippet as-is, preserving its id and timestamps.
   *
   * Unlike `create` this does not mint an id: it stores exactly the record it
   * is given. It is what a restore uses to put a snippet back as it was, and it
   * upserts by id, so restoring the same snippet twice cannot duplicate it.
   */
  insert: (snippet: Snippet) => Promise<Snippet>
  /** Removes a snippet. Resolving is not an error when it was already absent. */
  remove: (id: string) => Promise<void>
  /**
   * Discards every snippet. Also drops any quarantined payload, since a reset is
   * the one moment the user has asked for that data to be gone for good.
   */
  clear: () => Promise<void>
}

/**
 * The archive store the interface talks to.
 *
 * `add` is an upsert keyed by kind and record id, which is what guarantees an
 * item can only ever appear in the archive once. `remove` addresses a single
 * entry; resolving is not an error when it was already absent.
 */
export type ArchiveRepository = {
  /** Every archived record. Ordering is a presentation concern; the UI sorts. */
  list: () => Promise<ArchivedItem[]>
  /** Stores an entry, replacing any existing one for the same kind and id. */
  add: (entry: ArchivedItem) => Promise<ArchivedItem>
  /** Removes the entry for a record. Resolving is not an error when absent. */
  remove: (type: ArchiveItemType, id: string) => Promise<void>
  /**
   * Discards every archived record. Also drops any quarantined payload, since a
   * reset is the one moment the user has asked for that data to be gone.
   */
  clear: () => Promise<void>
}
