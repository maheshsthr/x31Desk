/**
 * x31Desk — reading and writing every workspace collection in one place.
 * ---------------------------------------------------------------------------
 * Two features need the *same* whole-workspace access and must agree on it
 * exactly, or a record could survive a backup round trip in one shape and come
 * back as another:
 *
 *   * the one-time `localStorage` -> SQLite import (`migration.ts`);
 *   * backup and restore (`backup.ts`).
 *
 * So the destination readers, the insert-if-absent writers and the canonical
 * keying live here, once. `migration.ts` keeps the policy that is genuinely its
 * own -- the completion marker and the "refuse rather than overwrite" rule --
 * and delegates every read and write to this module.
 *
 * The statements here deliberately do *not* go through the repositories. Two
 * reasons: a whole-collection write has to stay inside the caller's one
 * transaction (the repositories open transactions of their own), and the merge
 * rule is "insert if absent, never overwrite", which is the opposite of the
 * repositories' upsert. Row *reading* still goes through the repositories'
 * exported converters, so a row is interpreted in exactly one place.
 *
 * Reading an archive row whose `data` will not parse back never quarantines it
 * here. A backup export is a read-only operation and must not write to the
 * corruption vault as a side effect; it counts the rows instead and reports
 * them, so the user is told rather than surprised.
 */

import type { DatabaseSync } from 'node:sqlite'

import type { MigrationCollectionName, MigrationSource } from '@/data/ipc/contract'
import { archivedRecordId, type ArchivedItem } from '@/types/archive'
import type { Note } from '@/types/note'
import type { Snippet } from '@/types/snippet'
import type { Task } from '@/types/task'

import { canonicalArchiveItem, canonicalNote, canonicalSnippet, canonicalTask } from './canonical.ts'
import { toArchivedItem } from './repositories/archiveRepository.ts'
import { toNote } from './repositories/noteRepository.ts'
import { toSnippet } from './repositories/snippetRepository.ts'
import { toTask } from './repositories/taskRepository.ts'
import { asRows, readString, toBinding } from './rows.ts'

/** One source record with its canonical form already computed. */
export type SourceEntry<T> = { readonly record: T; readonly canonical: string }

/** Every source collection, keyed and canonicalised. */
export type SourceMaps = {
  readonly notes: Map<string, SourceEntry<Note>>
  readonly tasks: Map<string, SourceEntry<Task>>
  readonly snippets: Map<string, SourceEntry<Snippet>>
  readonly archive: Map<string, SourceEntry<ArchivedItem>>
}

/** Every destination collection: key to canonical form. */
export type DestinationMaps = {
  readonly notes: Map<string, string>
  readonly tasks: Map<string, string>
  readonly snippets: Map<string, string>
  readonly archive: Map<string, string>
}

/**
 * The canonical stand-in for an archive row whose payload would not read back.
 *
 * Every canonical form begins with `[`, so this sentinel -- which does not --
 * can never equal one: an unreadable row is therefore always a *mismatch*
 * against any source record sharing its key, which is exactly the "never
 * silently overwrite" property the import and merge both need.
 */
export const UNREADABLE_ROW_CANONICAL = '<unreadable>'

/**
 * The `(type, record_id)` identity an archived item is stored under.
 *
 * Record ids are only unique within their own module -- a note and a task may
 * legitimately share one -- so the key pairs the kind with the id, matching the
 * `archiveKey` the renderer's adapter builds.
 */
export function archivedRowKey(type: string, recordId: string): string {
  return `${type}:${recordId}`
}

/** The `(type, record_id)` key of one archived item. */
export function archivedItemKey(item: ArchivedItem): string {
  return archivedRowKey(item.type, archivedRecordId(item))
}

/**
 * Folds one collection into a keyed map.
 *
 * Two records sharing a key with *identical* content collapse to one -- a
 * backup taken twice, or a document that lists the same record twice, is not an
 * error. A repeat with *different* content is reported through
 * `onDuplicateDiffers` and the first record is kept, so the caller decides what
 * that means: the migration refuses the whole import, the backup importer
 * refuses the file.
 */
export function foldCollection<T>(
  records: readonly T[],
  keyOf: (record: T) => string,
  canonicalOf: (record: T) => string,
  into: Map<string, SourceEntry<T>>,
  onDuplicateDiffers: (key: string) => void,
): void {
  for (const record of records) {
    const key = keyOf(record)
    const canonical = canonicalOf(record)
    const existing = into.get(key)

    if (existing === undefined) {
      into.set(key, { record, canonical })
    } else if (existing.canonical !== canonical) {
      onDuplicateDiffers(key)
    }
  }
}

/** Folds a whole source into keyed maps, reporting every ambiguous key. */
export function foldWorkspace(
  source: MigrationSource,
  onDuplicateDiffers: (collection: MigrationCollectionName, key: string) => void = () => undefined,
): SourceMaps {
  const notes = new Map<string, SourceEntry<Note>>()
  const tasks = new Map<string, SourceEntry<Task>>()
  const snippets = new Map<string, SourceEntry<Snippet>>()
  const archive = new Map<string, SourceEntry<ArchivedItem>>()

  foldCollection(source.notes, (note) => note.id, canonicalNote, notes, (key) =>
    onDuplicateDiffers('notes', key),
  )
  foldCollection(source.tasks, (task) => task.id, canonicalTask, tasks, (key) =>
    onDuplicateDiffers('tasks', key),
  )
  foldCollection(source.snippets, (snippet) => snippet.id, canonicalSnippet, snippets, (key) =>
    onDuplicateDiffers('snippets', key),
  )
  foldCollection(source.archive, archivedItemKey, canonicalArchiveItem, archive, (key) =>
    onDuplicateDiffers('archive', key),
  )

  return { notes, tasks, snippets, archive }
}

/** Reads every current note, keyed by id, in canonical form. */
function readDestinationNotes(database: DatabaseSync): Map<string, string> {
  const map = new Map<string, string>()

  for (const row of asRows(
    database.prepare('SELECT id, title, content, created_at, updated_at FROM notes').all(),
  )) {
    const note = toNote(row)
    map.set(note.id, canonicalNote(note))
  }

  return map
}

/** Reads every current task, keyed by id, in canonical form. */
function readDestinationTasks(database: DatabaseSync): Map<string, string> {
  const map = new Map<string, string>()

  for (const row of asRows(
    database
      .prepare(
        'SELECT id, title, description, due_date, priority, completed, created_at, updated_at, completed_at FROM tasks',
      )
      .all(),
  )) {
    const task = toTask(row)
    map.set(task.id, canonicalTask(task))
  }

  return map
}

/** Reads every current snippet, with its ordered tags, in canonical form. */
function readDestinationSnippets(database: DatabaseSync): Map<string, string> {
  const tagsBySnippet = new Map<string, string[]>()

  for (const row of asRows(
    database.prepare('SELECT snippet_id, tag FROM snippet_tags ORDER BY snippet_id, position').all(),
  )) {
    const id = readString(row, 'snippet_id')
    const tags = tagsBySnippet.get(id) ?? []
    tags.push(readString(row, 'tag'))
    tagsBySnippet.set(id, tags)
  }

  const map = new Map<string, string>()

  for (const row of asRows(
    database.prepare('SELECT id, title, code, language, created_at, updated_at FROM snippets').all(),
  )) {
    const id = readString(row, 'id')
    const snippet = toSnippet(row, tagsBySnippet.get(id) ?? [])
    map.set(id, canonicalSnippet(snippet))
  }

  return map
}

/**
 * Reads every current archive row, keyed by `(type, record_id)`.
 *
 * A row whose `data` cannot be read back is *not* skipped silently: it is
 * recorded under the {@link UNREADABLE_ROW_CANONICAL} sentinel so that, if the
 * source names the same key, the mismatch is a conflict rather than a silent
 * overwrite. Rows are read raw (not through the repository) precisely because
 * the repository would preserve-and-skip them.
 */
function readDestinationArchive(database: DatabaseSync): Map<string, string> {
  const map = new Map<string, string>()

  for (const row of asRows(database.prepare('SELECT type, record_id, data FROM archive').all())) {
    const key = archivedRowKey(readString(row, 'type'), readString(row, 'record_id'))
    const entry = toArchivedItem(row)
    map.set(key, entry === null ? UNREADABLE_ROW_CANONICAL : canonicalArchiveItem(entry))
  }

  return map
}

/** Reads every destination collection, keyed and in canonical form. */
export function readDestination(database: DatabaseSync): DestinationMaps {
  return {
    notes: readDestinationNotes(database),
    tasks: readDestinationTasks(database),
    snippets: readDestinationSnippets(database),
    archive: readDestinationArchive(database),
  }
}

/** A whole-workspace read, plus what could not be read out of the archive. */
export type WorkspaceSnapshot = {
  readonly source: MigrationSource
  /**
   * Archive rows whose `data` column would not read back as an
   * {@link ArchivedItem}. They are counted rather than written to the
   * corruption vault, because an export must not change the database.
   */
  readonly unreadableArchiveRows: number
}

/** Reads every record of every collection, in insertion order. */
export function readWorkspace(database: DatabaseSync): WorkspaceSnapshot {
  const notes = asRows(
    database.prepare('SELECT id, title, content, created_at, updated_at FROM notes ORDER BY rowid').all(),
  ).map(toNote)

  const tasks = asRows(
    database
      .prepare(
        'SELECT id, title, description, due_date, priority, completed, created_at, updated_at, completed_at FROM tasks ORDER BY rowid',
      )
      .all(),
  ).map(toTask)

  const tagsBySnippet = new Map<string, string[]>()

  for (const row of asRows(
    database.prepare('SELECT snippet_id, tag FROM snippet_tags ORDER BY snippet_id, position').all(),
  )) {
    const id = readString(row, 'snippet_id')
    const tags = tagsBySnippet.get(id) ?? []
    tags.push(readString(row, 'tag'))
    tagsBySnippet.set(id, tags)
  }

  const snippets = asRows(
    database.prepare('SELECT id, title, code, language, created_at, updated_at FROM snippets ORDER BY rowid').all(),
  ).map((row) => toSnippet(row, tagsBySnippet.get(readString(row, 'id')) ?? []))

  const archive: ArchivedItem[] = []
  let unreadableArchiveRows = 0

  for (const row of asRows(
    database
      .prepare('SELECT type, record_id, archived_at, data FROM archive ORDER BY archived_at DESC, rowid DESC')
      .all(),
  )) {
    const entry = toArchivedItem(row)

    if (entry === null) {
      unreadableArchiveRows += 1
    } else {
      archive.push(entry)
    }
  }

  return {
    source: { notes, tasks, snippets, archive },
    unreadableArchiveRows,
  }
}

/**
 * Inserts the source notes the destination does not already hold.
 *
 * The skip is the whole of the "never overwrite" guarantee: `destination.has`
 * is checked against the map read *before* any write, so a record the workspace
 * already holds is left exactly as it is, whether or not the two agree.
 */
export function writeNotes(
  database: DatabaseSync,
  source: Map<string, SourceEntry<Note>>,
  destination: Map<string, string>,
): void {
  const insert = database.prepare(
    'INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )

  for (const [key, entry] of source) {
    if (destination.has(key)) {
      continue
    }

    const note = entry.record
    insert.run(note.id, note.title, note.content, note.createdAt, note.updatedAt)
  }
}

/** Inserts the source tasks the destination does not already hold. */
export function writeTasks(
  database: DatabaseSync,
  source: Map<string, SourceEntry<Task>>,
  destination: Map<string, string>,
): void {
  const insert = database.prepare(
    'INSERT INTO tasks (id, title, description, due_date, priority, completed, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )

  for (const [key, entry] of source) {
    if (destination.has(key)) {
      continue
    }

    const task = entry.record
    insert.run(
      task.id,
      task.title,
      task.description,
      toBinding(task.dueDate),
      task.priority,
      toBinding(task.completed),
      task.createdAt,
      task.updatedAt,
      toBinding(task.completedAt),
    )
  }
}

/** Inserts the source snippets and their ordered tags where the destination is empty. */
export function writeSnippets(
  database: DatabaseSync,
  source: Map<string, SourceEntry<Snippet>>,
  destination: Map<string, string>,
): void {
  const insert = database.prepare(
    'INSERT INTO snippets (id, title, code, language, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const insertTag = database.prepare('INSERT INTO snippet_tags (snippet_id, position, tag) VALUES (?, ?, ?)')

  for (const [key, entry] of source) {
    if (destination.has(key)) {
      continue
    }

    const snippet = entry.record
    insert.run(snippet.id, snippet.title, snippet.code, snippet.language, snippet.createdAt, snippet.updatedAt)

    snippet.tags.forEach((tag, position) => {
      insertTag.run(snippet.id, position, tag)
    })
  }
}

/** Inserts the source archive entries the destination does not already hold. */
export function writeArchive(
  database: DatabaseSync,
  source: Map<string, SourceEntry<ArchivedItem>>,
  destination: Map<string, string>,
): void {
  const insert = database.prepare('INSERT INTO archive (type, record_id, archived_at, data) VALUES (?, ?, ?, ?)')

  for (const [key, entry] of source) {
    if (destination.has(key)) {
      continue
    }

    const item = entry.record
    insert.run(item.type, archivedRecordId(item), item.archivedAt, JSON.stringify(item))
  }
}

/**
 * Clears every workspace collection, and nothing else.
 *
 * The `meta` table is deliberately left alone: it holds the migration
 * completion marker, which describes how the database was brought up, not the
 * user's work. The `archive_corruption` vault is left alone because a restore
 * is not a reset -- preserved bytes are not workspace data, and nothing the
 * user asked for here says "discard what could not be read".
 */
export function clearWorkspace(database: DatabaseSync): void {
  // `snippet_tags` first: it references `snippets`, and foreign keys are on.
  database.exec('DELETE FROM snippet_tags')
  database.exec('DELETE FROM snippets')
  database.exec('DELETE FROM notes')
  database.exec('DELETE FROM tasks')
  database.exec('DELETE FROM archive')
}

function matches(source: Map<string, SourceEntry<unknown>>, destination: Map<string, string>): boolean {
  if (source.size !== destination.size) {
    return false
  }

  for (const [key, entry] of source) {
    if (destination.get(key) !== entry.canonical) {
      return false
    }
  }

  return true
}

function mapsEqual(
  left: Map<string, SourceEntry<unknown>>,
  right: Map<string, SourceEntry<unknown>>,
): boolean {
  if (left.size !== right.size) {
    return false
  }

  for (const [key, entry] of left) {
    if (right.get(key)?.canonical !== entry.canonical) {
      return false
    }
  }

  return true
}

/**
 * True when two keyed sources describe exactly the same records, field for
 * field.
 *
 * Used to check an export by reading it back: the file must say what the
 * snapshot said, or it is not a backup of this workspace.
 */
export function sourceMapsEqual(left: SourceMaps, right: SourceMaps): boolean {
  return (
    mapsEqual(left.notes, right.notes) &&
    mapsEqual(left.tasks, right.tasks) &&
    mapsEqual(left.snippets, right.snippets) &&
    mapsEqual(left.archive, right.archive)
  )
}

/**
 * True when the destination holds exactly the source, field for field.
 *
 * Used to verify a *replace*, which clears the collections first, so the two
 * sides are expected to be identical rather than merely compatible.
 */
export function destinationMatches(source: SourceMaps, destination: DestinationMaps): boolean {
  return (
    matches(source.notes, destination.notes) &&
    matches(source.tasks, destination.tasks) &&
    matches(source.snippets, destination.snippets) &&
    matches(source.archive, destination.archive)
  )
}

function holdsMerged(
  source: Map<string, SourceEntry<unknown>>,
  destination: Map<string, string>,
  conflicted: ReadonlySet<string> | undefined,
): boolean {
  for (const [key, entry] of source) {
    if (destination.get(key) === entry.canonical) {
      continue
    }

    // The only acceptable reason for a destination record to disagree with the
    // source is that it is a conflict -- in which case it is expected to, and
    // the caller's merge never wrote it. Anything else failed to verify.
    if (conflicted === undefined || !conflicted.has(key)) {
      return false
    }
  }

  return true
}

/**
 * True when the destination holds every non-conflicting source record
 * unchanged, and every conflicting record still disagrees with the source.
 *
 * Used to verify a *merge*: a record the workspace already held with different
 * content must be found still different after the import -- that is what
 * "reported, never overwritten" means -- and every record that was written must
 * match the source exactly.
 */
export function destinationHoldsMerged(
  source: SourceMaps,
  destination: DestinationMaps,
  conflicts: ReadonlyMap<MigrationCollectionName, ReadonlySet<string>>,
): boolean {
  return (
    holdsMerged(source.notes, destination.notes, conflicts.get('notes')) &&
    holdsMerged(source.tasks, destination.tasks, conflicts.get('tasks')) &&
    holdsMerged(source.snippets, destination.snippets, conflicts.get('snippets')) &&
    holdsMerged(source.archive, destination.archive, conflicts.get('archive'))
  )
}
