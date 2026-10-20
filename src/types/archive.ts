import { isNote, type Note } from '@/types/note'
import { isSnippet, type Snippet } from '@/types/snippet'
import { isTask, type Task } from '@/types/task'

/** The three kinds of record the archive can hold. */
export const ARCHIVE_ITEM_TYPES = ['note', 'task', 'snippet'] as const

/** Which module an archived record came from. */
export type ArchiveItemType = (typeof ARCHIVE_ITEM_TYPES)[number]

/**
 * An archived record.
 *
 * Each variant wraps the original record *verbatim* beside the moment it was
 * set aside. Keeping the whole record — id, timestamps, tags, completion state
 * and all — is what lets a restore put the item back exactly as it was rather
 * than re-creating an approximation of it.
 */
export type ArchivedNote = {
  type: 'note'
  /** Epoch milliseconds, as everywhere else in the application. */
  archivedAt: number
  note: Note
}

export type ArchivedTask = {
  type: 'task'
  archivedAt: number
  task: Task
}

export type ArchivedSnippet = {
  type: 'snippet'
  archivedAt: number
  snippet: Snippet
}

/** One entry in the archive. */
export type ArchivedItem = ArchivedNote | ArchivedTask | ArchivedSnippet

/** `all` keeps every kind; any other value narrows the archive to one. */
export type ArchiveFilter = ArchiveItemType | 'all'

/**
 * The identity of an archived record, scoped by its kind.
 *
 * Record ids are only unique within their own module — a note and a task may
 * legitimately share one — so the key pairs the kind with the id. It is what
 * lets an archive write upsert instead of duplicating, and what makes a restore
 * or a permanent delete address exactly one entry.
 */
export function archiveKey(type: ArchiveItemType, id: string): string {
  return `${type}:${id}`
}

/** The id of the record an archived entry wraps. */
export function archivedRecordId(item: ArchivedItem): string {
  switch (item.type) {
    case 'note':
      return item.note.id
    case 'task':
      return item.task.id
    case 'snippet':
      return item.snippet.id
  }
}

/**
 * Validates one entry read from storage.
 *
 * The embedded record is validated by its own module's guard, so an archived
 * note can never be a half-formed note: anything that fails is discarded and
 * the original payload is quarantined, exactly as the active collections do.
 */
export function isArchivedItem(value: unknown): value is ArchivedItem {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate: Record<string, unknown> = value as Record<string, unknown>

  if (typeof candidate.archivedAt !== 'number' || !Number.isFinite(candidate.archivedAt)) {
    return false
  }

  switch (candidate.type) {
    case 'note':
      return isNote(candidate.note)
    case 'task':
      return isTask(candidate.task)
    case 'snippet':
      return isSnippet(candidate.snippet)
    default:
      return false
  }
}
