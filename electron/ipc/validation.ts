/**
 * x31Desk — validation of incoming repository IPC payloads.
 * ---------------------------------------------------------------------------
 * Every data handler in the main process is reached through `ipcRenderer.invoke`
 * from a renderer that is only trusted because the preload wraps it. A payload
 * that arrives over IPC is therefore untrusted input, and this module is the one
 * place it is checked before a repository ever sees it.
 *
 * The record guards are the application's own — `isNote`, `isTask`, `isSnippet`
 * and `isArchivedItem` — imported rather than re-implemented, so a record that
 * the `localStorage` reader would discard is rejected here too, and the two
 * never drift. The draft guards and the per-operation payload parsers are
 * defined here because a draft is an editor shape the main process never stored
 * before, and each channel's payload is a small, known object.
 *
 * A parser returns the narrowed payload, or `null` when the value does not
 * match. It never throws, so a handler can turn a rejection into its own
 * response without a try/catch around validation.
 */

import { ARCHIVE_ITEM_TYPES, isArchivedItem, type ArchivedItem, type ArchiveItemType } from '@/types/archive'
import type { FlushReport, MigrationSource } from '@/data/ipc/contract'
import { isNote, type Note, type NoteDraft } from '@/types/note'
import { isSnippet, isSnippetLanguage, type Snippet, type SnippetDraft } from '@/types/snippet'
import { isTask, isTaskPriority, type Task, type TaskDraft } from '@/types/task'
import { isThemePreference, type ThemePreference } from '@/types/theme'
import { isDateValue } from '@/utils/date'

/** Narrows a value to a plain, non-array object. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** An id is opaque, but must be present and non-empty. */
function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** Narrows a value to an archive kind. */
export function isArchiveItemType(value: unknown): value is ArchiveItemType {
  return (
    typeof value === 'string' && (ARCHIVE_ITEM_TYPES as readonly string[]).includes(value)
  )
}

/** Validates a note draft. Titles and content may legitimately be empty. */
export function isNoteDraft(value: unknown): value is NoteDraft {
  const record = asRecord(value)

  return (
    record !== null && typeof record.title === 'string' && typeof record.content === 'string'
  )
}

/** Validates a task draft, including the closed priority union and the due date. */
export function isTaskDraft(value: unknown): value is TaskDraft {
  const record = asRecord(value)

  return (
    record !== null &&
    typeof record.title === 'string' &&
    typeof record.description === 'string' &&
    (record.dueDate === null ||
      (typeof record.dueDate === 'string' && isDateValue(record.dueDate))) &&
    isTaskPriority(record.priority)
  )
}

/** Validates a snippet draft. The tag field is the editor's raw text. */
export function isSnippetDraft(value: unknown): value is SnippetDraft {
  const record = asRecord(value)

  return (
    record !== null &&
    typeof record.title === 'string' &&
    typeof record.code === 'string' &&
    isSnippetLanguage(record.language) &&
    typeof record.tags === 'string'
  )
}

/**
 * Narrows a value to an array of records that all pass `guard`.
 *
 * Unlike the collection readers, this rejects the whole array when any one
 * entry is bad — the import may not drop a record it cannot understand.
 */
function isRecordArray<T>(value: unknown, guard: (entry: unknown) => entry is T): value is readonly T[] {
  return Array.isArray(value) && value.every(guard)
}

/** Validates a whole `localStorage` snapshot offered for import. */
export function isMigrationSource(value: unknown): value is MigrationSource {
  const record = asRecord(value)

  return (
    record !== null &&
    isRecordArray(record.notes, isNote) &&
    isRecordArray(record.tasks, isTask) &&
    isRecordArray(record.snippets, isSnippet) &&
    isRecordArray(record.archive, isArchivedItem)
  )
}

// ---------------------------------------------------------------------------
// per-channel payload parsers
// ---------------------------------------------------------------------------

export type IdPayload = { readonly id: string }

/** Parses `{ id }`, as used by the `remove` channels. */
export function parseIdPayload(value: unknown): IdPayload | null {
  const record = asRecord(value)

  return record !== null && isId(record.id) ? { id: record.id } : null
}

/** Parses `{ id, draft }` for a note update. */
export function parseNoteUpdate(
  value: unknown,
): { readonly id: string; readonly draft: NoteDraft } | null {
  const record = asRecord(value)

  return record !== null && isId(record.id) && isNoteDraft(record.draft)
    ? { id: record.id, draft: record.draft }
    : null
}

/** Parses `{ note }` for a note insert. */
export function parseNoteInsert(value: unknown): { readonly note: Note } | null {
  const record = asRecord(value)

  return record !== null && isNote(record.note) ? { note: record.note } : null
}

/** Parses `{ draft }` for a task create. */
export function parseTaskCreate(value: unknown): { readonly draft: TaskDraft } | null {
  const record = asRecord(value)

  return record !== null && isTaskDraft(record.draft) ? { draft: record.draft } : null
}

/** Parses `{ id, draft }` for a task update. */
export function parseTaskUpdate(
  value: unknown,
): { readonly id: string; readonly draft: TaskDraft } | null {
  const record = asRecord(value)

  return record !== null && isId(record.id) && isTaskDraft(record.draft)
    ? { id: record.id, draft: record.draft }
    : null
}

/** Parses `{ id, completed }` for ticking a task off or reopening it. */
export function parseTaskSetCompleted(
  value: unknown,
): { readonly id: string; readonly completed: boolean } | null {
  const record = asRecord(value)

  return record !== null && isId(record.id) && typeof record.completed === 'boolean'
    ? { id: record.id, completed: record.completed }
    : null
}

/** Parses `{ task }` for a task insert. */
export function parseTaskInsert(value: unknown): { readonly task: Task } | null {
  const record = asRecord(value)

  return record !== null && isTask(record.task) ? { task: record.task } : null
}

/** Parses `{ draft }` for a snippet create. */
export function parseSnippetCreate(
  value: unknown,
): { readonly draft: SnippetDraft } | null {
  const record = asRecord(value)

  return record !== null && isSnippetDraft(record.draft) ? { draft: record.draft } : null
}

/** Parses `{ id, draft }` for a snippet update. */
export function parseSnippetUpdate(
  value: unknown,
): { readonly id: string; readonly draft: SnippetDraft } | null {
  const record = asRecord(value)

  return record !== null && isId(record.id) && isSnippetDraft(record.draft)
    ? { id: record.id, draft: record.draft }
    : null
}

/** Parses `{ snippet }` for a snippet insert. */
export function parseSnippetInsert(value: unknown): { readonly snippet: Snippet } | null {
  const record = asRecord(value)

  return record !== null && isSnippet(record.snippet) ? { snippet: record.snippet } : null
}

/** Parses `{ entry }` for an archive add. */
export function parseArchiveAdd(value: unknown): { readonly entry: ArchivedItem } | null {
  const record = asRecord(value)

  return record !== null && isArchivedItem(record.entry) ? { entry: record.entry } : null
}

/** Parses `{ type, id }` for an archive remove. */
export function parseArchiveRemove(
  value: unknown,
): { readonly type: ArchiveItemType; readonly id: string } | null {
  const record = asRecord(value)

  return record !== null && isArchiveItemType(record.type) && isId(record.id)
    ? { type: record.type, id: record.id }
    : null
}

/** Parses `{ source }` for the one-time import. */
export function parseMigrationImport(value: unknown): { readonly source: MigrationSource } | null {
  const record = asRecord(value)

  return record !== null && isMigrationSource(record.source) ? { source: record.source } : null
}

/**
 * Parses the renderer's answer to a close-handshake flush request.
 *
 * Only a genuine boolean is trusted: a missing, malformed or hostile payload is
 * treated as "not confirmed", so a close can never be told a flush succeeded on
 * the strength of a value the renderer did not actually send.
 */
export function parseFlushReport(value: unknown): FlushReport | null {
  const record = asRecord(value)

  return record !== null && typeof record.ok === 'boolean' ? { ok: record.ok } : null
}

/**
 * Parses `{ preference }` for the native-chrome theme.
 *
 * The preference is checked against the application's own guard, so only the
 * three values `nativeTheme.themeSource` accepts ever reach the main process's
 * native theme — an unexpected value leaves the title bar exactly as it was.
 */
export function parseThemeSource(
  value: unknown,
): { readonly preference: ThemePreference } | null {
  const record = asRecord(value)

  return record !== null && isThemePreference(record.preference)
    ? { preference: record.preference }
    : null
}
