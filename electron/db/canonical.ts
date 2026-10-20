/**
 * x31Desk — deterministic serialization of a record.
 * ---------------------------------------------------------------------------
 * The one-time `localStorage` → SQLite import has to answer a single question
 * for every record it finds on either side: *is this the same record?* A plain
 * `JSON.stringify` of a record cannot answer that safely — an object's key order
 * is not guaranteed to survive a round trip (`localStorage` holds whatever the
 * writer produced, SQLite holds a row rebuilt column by column, and the archive
 * embeds a nested record as JSON) — so two representations of one record could
 * disagree byte-for-byte while describing the very same data.
 *
 * Each function below therefore builds one canonical string from an explicit,
 * fixed list of fields. Two records are the same record exactly when their
 * canonical strings are equal, and the strings cover *every* persisted field:
 * a note's body, a task's completion state and due date, a snippet's ordered
 * tags and language, and — for an archived item — the whole wrapped record plus
 * the moment it was set aside.
 *
 * `JSON.stringify` of an array of primitives is used rather than a handmade
 * separator because it escapes values that contain the separator (a title may
 * contain any character at all), so two different records can never collide.
 */

import type { ArchivedItem } from '@/types/archive'
import type { Note } from '@/types/note'
import type { Snippet } from '@/types/snippet'
import type { Task } from '@/types/task'

/** Canonical form of a note — id, title, body and both timestamps. */
export function canonicalNote(note: Note): string {
  return JSON.stringify([note.id, note.title, note.content, note.createdAt, note.updatedAt])
}

/**
 * Canonical form of a task — every column, including the `dueDate` calendar day
 * (a `YYYY-MM-DD` string or `null`) and the completion timestamps.
 */
export function canonicalTask(task: Task): string {
  return JSON.stringify([
    task.id,
    task.title,
    task.description,
    task.dueDate,
    task.priority,
    task.completed,
    task.createdAt,
    task.updatedAt,
    task.completedAt,
  ])
}

/**
 * Canonical form of a snippet — code, language and the tags in their stored
 * order. Tag order is significant to the editor, so it is part of the identity
 * rather than sorted away.
 */
export function canonicalSnippet(snippet: Snippet): string {
  return JSON.stringify([
    snippet.id,
    snippet.title,
    snippet.code,
    snippet.language,
    snippet.tags,
    snippet.createdAt,
    snippet.updatedAt,
  ])
}

/**
 * Canonical form of an archived item — the kind, the moment it was archived and
 * the wrapped record. The nested record is reduced through the same canonical
 * functions above, so an archive entry is equal to another exactly when the
 * record it holds is.
 */
export function canonicalArchiveItem(entry: ArchivedItem): string {
  switch (entry.type) {
    case 'note':
      return JSON.stringify(['note', entry.archivedAt, canonicalNote(entry.note)])
    case 'task':
      return JSON.stringify(['task', entry.archivedAt, canonicalTask(entry.task)])
    case 'snippet':
      return JSON.stringify(['snippet', entry.archivedAt, canonicalSnippet(entry.snippet)])
  }
}
