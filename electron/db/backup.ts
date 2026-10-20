/**
 * x31Desk — backup and restore of the whole workspace.
 * ---------------------------------------------------------------------------
 * A backup is a *faithful copy*, not an interchange format: the records in the
 * file are the application's own types — ids, timestamps, snippet tag order,
 * completion state and the wrapped archive payload all intact — so restoring one
 * puts the workspace back exactly as it was rather than as an approximation.
 *
 * Three properties shape every function here:
 *
 *   * **Nothing is written until the file has been read and judged.** The
 *     inspect step validates the whole document — version, record types, sizes,
 *     ids, and the counts the file claims about itself — before the Settings
 *     page offers an import at all. The apply step validates *again*, because
 *     the document it receives has crossed the IPC boundary and is untrusted.
 *   * **A merge never overwrites.** A record the workspace already holds with
 *     different content is reported as a conflict and left exactly as it was.
 *     A record it holds identically is skipped, which is what makes importing
 *     the same backup twice a no-op rather than a duplication.
 *   * **Both writes are transactional and then verified.** Every apply runs in
 *     one transaction and re-reads what it wrote before committing; a
 *     verification failure rolls the whole thing back, so a failed import
 *     leaves the workspace exactly as it found it.
 *
 * The module never touches the filesystem or a native dialog directly. Both are
 * reached through injected ports (`BackupFiles`, `BackupDialogs`), so the
 * format and the merge logic are testable without a window, and the only code
 * that names a real path lives in `backupFiles.ts` and `main.ts`.
 */

import type { DatabaseSync } from 'node:sqlite'

import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupApplyOutcome,
  type BackupConflict,
  type BackupDocument,
  type BackupExportOutcome,
  type BackupImportMode,
  type BackupPreferences,
  type BackupPreview,
  type BackupRejectionReason,
  type MigrationCollectionName,
  type MigrationRecordCounts,
  type MigrationSource,
} from '@/data/ipc/contract'
import type { StorageErrorKind } from '@/data/storageError'
import { isArchivedItem } from '@/types/archive'
import { sanitizeEditorPreferences } from '@/types/editorPreferences'
import { isNote } from '@/types/note'
import { isSnippet } from '@/types/snippet'
import { isTask } from '@/types/task'
import { isThemePreference } from '@/types/theme'

import { classifyDatabaseError } from './errorKind.ts'
import { runInTransaction } from './transaction.ts'
import {
  clearWorkspace,
  destinationHoldsMerged,
  destinationMatches,
  foldWorkspace,
  readDestination,
  readWorkspace,
  sourceMapsEqual,
  writeArchive,
  writeNotes,
  writeSnippets,
  writeTasks,
  type SourceEntry,
} from './workspaceIO.ts'

// ---------------------------------------------------------------------------
// the format's fixed facts
// ---------------------------------------------------------------------------

/** The extension a backup is written with, and the picker filters on. */
export const BACKUP_EXTENSION = 'x31backup'

/** The part of a generated filename that is not the date. */
export const BACKUP_FILE_PREFIX = 'x31Desk-backup'

/**
 * The largest backup file the importer will read into memory.
 *
 * The limit exists because the whole file is parsed in one pass: without a
 * bound, a hostile or accidentally enormous file could exhaust the main
 * process's memory before validation ever runs. It is far above any workspace
 * this application has produced — the ceiling is also checked per collection,
 * so a file cannot smuggle an unbounded list inside a small byte count.
 */
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024

/** The most records one collection may hold in a backup. */
export const MAX_RECORDS_PER_COLLECTION = 100_000

// ---------------------------------------------------------------------------
// ports
// ---------------------------------------------------------------------------

/**
 * The native file dialogs, reduced to the two decisions this feature needs.
 *
 * Injected so the whole flow is testable without Electron, and so `backup.ts`
 * never imports `electron` — which is what keeps it loadable under the plain
 * Node test runner.
 */
export type BackupDialogs = {
  /** Resolves with the chosen path, or `null` when the user cancelled. */
  readonly showSave: (suggestedFileName: string) => Promise<string | null>
  /** Resolves with the chosen path, or `null` when the user cancelled. */
  readonly showOpen: () => Promise<string | null>
}

/** Filesystem access, reduced to what a backup write and read need. */
export type BackupFiles = {
  /** The size of an existing file, in bytes. */
  readonly size: (path: string) => number
  /** The whole file, decoded as UTF-8. */
  readonly read: (path: string) => string
  /** Writes so that a concurrent reader sees either no file or a whole one. */
  readonly writeAtomic: (path: string, contents: string) => void
  /** Best-effort removal, used to discard a file that failed verification. */
  readonly remove: (path: string) => void
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * The filename an export suggests: `x31Desk-backup-YYYY-MM-DD.x31backup`.
 *
 * The date is local, because "today" means the user's today, and it is embedded
 * so a directory of exports stays sortable and each file is identifiable
 * without being opened.
 */
export function backupFileName(date: Date): string {
  return `${BACKUP_FILE_PREFIX}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.${BACKUP_EXTENSION}`
}

/**
 * Reduces an untrusted value to the preferences a document may carry.
 *
 * Each key is kept only if it is *present*; an absent key means "leave the
 * workspace's value alone" on restore. A key that is present but unusable is
 * dropped rather than defaulted, because silently substituting a default would
 * change a setting the user never asked to change.
 *
 * Keys this build does not recognise are ignored, never rejected. That is what
 * keeps a backup written by a version that shipped a UI Scale setting readable:
 * its `uiScale` is simply not carried forward, while `theme` and `editor` from
 * the same document still restore. A document holding *only* unknown keys
 * reduces to `null`, so the section is omitted rather than written back empty.
 */
export function sanitizeBackupPreferences(value: unknown): BackupPreferences | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const candidate = value as Record<string, unknown>
  const result: {
    theme?: BackupPreferences['theme']
    editor?: BackupPreferences['editor']
  } = {}

  if ('theme' in candidate && isThemePreference(candidate.theme)) {
    result.theme = candidate.theme
  }

  if ('editor' in candidate && typeof candidate.editor === 'object' && candidate.editor !== null) {
    result.editor = sanitizeEditorPreferences(candidate.editor)
  }

  return Object.keys(result).length === 0 ? null : result
}

/**
 * How a rejection is worded for the user.
 *
 * The messages say what is wrong with the *file*, never what is in it: a
 * backup's contents are the user's data, and an error surfaced in a dialog is
 * not the place to echo it back.
 */
const REJECTION_MESSAGES: Record<BackupRejectionReason, string> = {
  'not-a-backup': 'That file is not an x31Desk backup.',
  'unsupported-version':
    'That backup was written by a newer version of x31Desk and cannot be read by this one.',
  malformed: 'That backup file is damaged or incomplete, so it was not imported.',
  'too-large': 'That backup file is too large to import.',
  'too-many-records': 'That backup holds more records than this version can import.',
}

function rejection(reason: BackupRejectionReason, detail?: string): {
  ok: false
  reason: BackupRejectionReason
  message: string
} {
  return {
    ok: false,
    reason,
    message: detail === undefined ? REJECTION_MESSAGES[reason] : `${REJECTION_MESSAGES[reason]} ${detail}`,
  }
}

/** The sentence shown to the user for a rejection with no extra detail. */
export function backupRejectionMessage(reason: BackupRejectionReason): string {
  return REJECTION_MESSAGES[reason]
}

// ---------------------------------------------------------------------------
// building a document
// ---------------------------------------------------------------------------

/** Reads `PRAGMA user_version`, which describes the SQLite schema's structure. */
function readDatabaseVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get() as Record<string, unknown> | undefined
  const value = row?.user_version
  return typeof value === 'number' ? value : 0
}

/** The exact counts a document claims about the collections it carries. */
export function backupCounts(
  notes: number,
  tasks: number,
  snippets: number,
  archive: number,
): MigrationRecordCounts {
  return { notes, tasks, snippets, archive }
}

/**
 * Snapshots the whole workspace into a document, inside one transaction.
 *
 * The transaction matters even though the database is synchronous and single
 * writer: it pins the read to a single moment so the counts at the top of the
 * document cannot disagree with the records below it, which is the difference
 * between a file the importer trusts and one it refuses.
 */
export function buildBackupDocument(
  database: DatabaseSync,
  appVersion: string,
  preferences: BackupPreferences | null,
): { readonly document: BackupDocument; readonly unreadableArchiveRows: number } {
  const snapshot = runInTransaction(database, () => readWorkspace(database))
  const source = snapshot.source

  const document: BackupDocument = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion,
    databaseVersion: readDatabaseVersion(database),
    exportedAt: new Date().toISOString(),
    counts: backupCounts(
      source.notes.length,
      source.tasks.length,
      source.snippets.length,
      source.archive.length,
    ),
    notes: source.notes,
    tasks: source.tasks,
    snippets: source.snippets,
    archive: source.archive,
    ...(preferences === null ? {} : { preferences }),
  }

  return { document, unreadableArchiveRows: snapshot.unreadableArchiveRows }
}

// ---------------------------------------------------------------------------
// reading and judging a document
// ---------------------------------------------------------------------------

/** The outcome of reading a file: the validated document, or why it was refused. */
export type BackupValidation =
  | { readonly ok: true; readonly document: BackupDocument; readonly preview: BackupPreview }
  | { readonly ok: false; readonly reason: BackupRejectionReason; readonly message: string }

const COLLECTION_LABELS: Record<MigrationCollectionName, string> = {
  notes: 'notes',
  tasks: 'tasks',
  snippets: 'snippets',
  archive: 'archived items',
}

const COLLECTION_SINGULAR: Record<MigrationCollectionName, string> = {
  notes: 'note',
  tasks: 'task',
  snippets: 'snippet',
  archive: 'archived item',
}

type ParsedCollection<T> =
  | { readonly ok: true; readonly records: T[] }
  | { readonly ok: false; readonly reason: BackupRejectionReason; readonly message: string }

/** Validates one collection's array with the application's own record guard. */
function parseCollection<T>(
  value: unknown,
  name: MigrationCollectionName,
  guard: (candidate: unknown) => candidate is T,
): ParsedCollection<T> {
  if (!Array.isArray(value)) {
    return rejection('malformed', `Its ${COLLECTION_LABELS[name]} list is missing.`)
  }

  if (value.length > MAX_RECORDS_PER_COLLECTION) {
    return rejection('too-many-records')
  }

  const records: T[] = []

  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index]

    if (!guard(entry)) {
      return rejection(
        'malformed',
        `Item ${index + 1} in its ${COLLECTION_LABELS[name]} list is not a valid ${COLLECTION_SINGULAR[name]}.`,
      )
    }

    records.push(entry)
  }

  return { ok: true, records }
}

/**
 * Judges an already-parsed value as a backup document.
 *
 * Every field is checked, in the order that produces the most useful answer: the
 * magic string first (so a recovery export is told it is the wrong file rather
 * than that it is damaged), then the version, then the structure, then the
 * records, and finally the counts the file claims about itself — a mismatch
 * there means the document was truncated or edited, and is the cheapest signal
 * that a file should not be trusted.
 *
 * Shared by the inspect step and the apply step. The second call is not
 * redundant: apply receives its document over IPC, where nothing is trusted.
 */
export function validateBackupDocument(value: unknown): BackupValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return rejection('not-a-backup')
  }

  const candidate = value as Record<string, unknown>

  if (candidate.format !== BACKUP_FORMAT) {
    return rejection('not-a-backup')
  }

  if (typeof candidate.formatVersion !== 'number') {
    return rejection('not-a-backup')
  }

  if (candidate.formatVersion !== BACKUP_FORMAT_VERSION) {
    return rejection('unsupported-version', `This build can read version ${BACKUP_FORMAT_VERSION}.`)
  }

  if (typeof candidate.appVersion !== 'string') {
    return rejection('malformed', 'Its application version is missing.')
  }

  if (typeof candidate.databaseVersion !== 'number') {
    return rejection('malformed', 'Its database version is missing.')
  }

  if (typeof candidate.exportedAt !== 'string') {
    return rejection('malformed', 'Its export time is missing.')
  }

  const notes = parseCollection(candidate.notes, 'notes', isNote)
  if (!notes.ok) {
    return notes
  }

  const tasks = parseCollection(candidate.tasks, 'tasks', isTask)
  if (!tasks.ok) {
    return tasks
  }

  const snippets = parseCollection(candidate.snippets, 'snippets', isSnippet)
  if (!snippets.ok) {
    return snippets
  }

  const archive = parseCollection(candidate.archive, 'archive', isArchivedItem)
  if (!archive.ok) {
    return archive
  }

  const source = {
    notes: notes.records,
    tasks: tasks.records,
    snippets: snippets.records,
    archive: archive.records,
  }

  // An exact duplicate collapses harmlessly (the merge would skip it anyway),
  // but the same key with different content is a document that disagrees with
  // itself, and there is no safe way to guess which copy the user meant.
  const ambiguous: MigrationCollectionName[] = []

  foldWorkspace(source, (collection) => {
    if (!ambiguous.includes(collection)) {
      ambiguous.push(collection)
    }
  })

  if (ambiguous.length > 0) {
    return rejection(
      'malformed',
      `It lists the same record twice with different contents in its ${ambiguous.join(' and ')} list.`,
    )
  }

  const actualCounts = backupCounts(
    source.notes.length,
    source.tasks.length,
    source.snippets.length,
    source.archive.length,
  )

  const claimed = candidate.counts

  if (typeof claimed !== 'object' || claimed === null || Array.isArray(claimed)) {
    return rejection('malformed', 'Its record counts are missing.')
  }

  const claimedCounts = claimed as Record<string, unknown>

  for (const name of ['notes', 'tasks', 'snippets', 'archive'] as const) {
    if (claimedCounts[name] !== actualCounts[name]) {
      return rejection('malformed', 'Its record counts disagree with the records it holds.')
    }
  }

  const preferences = 'preferences' in candidate ? sanitizeBackupPreferences(candidate.preferences) : null

  const document: BackupDocument = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: candidate.appVersion,
    databaseVersion: candidate.databaseVersion,
    exportedAt: candidate.exportedAt,
    counts: actualCounts,
    notes: source.notes,
    tasks: source.tasks,
    snippets: source.snippets,
    archive: source.archive,
    ...(preferences === null ? {} : { preferences }),
  }

  return {
    ok: true,
    document,
    preview: {
      appVersion: document.appVersion,
      exportedAt: document.exportedAt,
      counts: actualCounts,
      hasPreferences: preferences !== null,
    },
  }
}

/** Parses a file's text and judges it as a backup document. */
export function parseBackupText(text: string): BackupValidation {
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return rejection('not-a-backup')
  }

  return validateBackupDocument(parsed)
}

// ---------------------------------------------------------------------------
// applying a document
// ---------------------------------------------------------------------------

/**
 * Thrown inside an apply transaction when the re-read does not match what was
 * written. It only ever aborts a transaction, so the workspace is left whole.
 */
export class BackupVerificationError extends Error {
  constructor() {
    super('backup verification failed')
    this.name = 'BackupVerificationError'
  }
}

type MutableCounts = Record<MigrationCollectionName, number>

type ApplyResult = {
  readonly counts: MigrationRecordCounts
  readonly unchanged: MigrationRecordCounts
  readonly conflicts: readonly BackupConflict[]
}

function zeroCounts(): MutableCounts {
  return { notes: 0, tasks: 0, snippets: 0, archive: 0 }
}

function sourceOf(document: BackupDocument): MigrationSource {
  return {
    notes: document.notes,
    tasks: document.tasks,
    snippets: document.snippets,
    archive: document.archive,
  }
}

/**
 * Sorts one collection's source against the destination into three buckets.
 *
 * `counts` is what the import adds, `unchanged` is what the workspace already
 * held identically (and which the import therefore skips), and `conflicts` is
 * what it holds *differently* — recorded, keyed, and then never written.
 */
function compare<T>(
  collection: MigrationCollectionName,
  source: Map<string, SourceEntry<T>>,
  destination: Map<string, string>,
  counts: MutableCounts,
  unchanged: MutableCounts,
  conflicts: BackupConflict[],
  conflictKeys: Map<MigrationCollectionName, Set<string>>,
): void {
  for (const [key, entry] of source) {
    const existing = destination.get(key)

    if (existing === undefined) {
      counts[collection] += 1
    } else if (existing === entry.canonical) {
      unchanged[collection] += 1
    } else {
      conflicts.push({ collection, id: key })

      const keys = conflictKeys.get(collection) ?? new Set<string>()
      keys.add(key)
      conflictKeys.set(collection, keys)
    }
  }
}

/** Merges a document into the workspace without ever overwriting a record. */
function mergeInto(database: DatabaseSync, document: BackupDocument): ApplyResult {
  const source = foldWorkspace(sourceOf(document))

  return runInTransaction(database, () => {
    const destination = readDestination(database)
    const counts = zeroCounts()
    const unchanged = zeroCounts()
    const conflicts: BackupConflict[] = []
    const conflictKeys = new Map<MigrationCollectionName, Set<string>>()

    compare('notes', source.notes, destination.notes, counts, unchanged, conflicts, conflictKeys)
    compare('tasks', source.tasks, destination.tasks, counts, unchanged, conflicts, conflictKeys)
    compare('snippets', source.snippets, destination.snippets, counts, unchanged, conflicts, conflictKeys)
    compare('archive', source.archive, destination.archive, counts, unchanged, conflicts, conflictKeys)

    writeNotes(database, source.notes, destination.notes)
    writeTasks(database, source.tasks, destination.tasks)
    writeSnippets(database, source.snippets, destination.snippets)
    writeArchive(database, source.archive, destination.archive)

    // Every record the import did *not* conflict on must now hold exactly the
    // source's content, and every record it did conflict on must still hold the
    // workspace's original content — which is what proves nothing was
    // overwritten, not merely that nothing was written twice.
    if (!destinationHoldsMerged(source, readDestination(database), conflictKeys)) {
      throw new BackupVerificationError()
    }

    return { counts, unchanged, conflicts }
  })
}

/** Replaces the workspace with a document, in one transaction, after verification. */
function replaceWith(database: DatabaseSync, document: BackupDocument): ApplyResult {
  const source = foldWorkspace(sourceOf(document))

  return runInTransaction(database, () => {
    clearWorkspace(database)

    // Read *after* the clear, so the writers see an empty destination and the
    // same insert-if-absent code that serves the merge writes all of it.
    const destination = readDestination(database)

    writeNotes(database, source.notes, destination.notes)
    writeTasks(database, source.tasks, destination.tasks)
    writeSnippets(database, source.snippets, destination.snippets)
    writeArchive(database, source.archive, destination.archive)

    if (!destinationMatches(source, readDestination(database))) {
      throw new BackupVerificationError()
    }

    return {
      counts: {
        notes: source.notes.size,
        tasks: source.tasks.size,
        snippets: source.snippets.size,
        archive: source.archive.size,
      },
      unchanged: zeroCounts(),
      conflicts: [],
    }
  })
}

/**
 * Applies an already-validated document to the database.
 *
 * `merge` is additive and non-destructive; `replace` clears the four
 * collections first. Both run in one transaction and verify before committing,
 * so a failure leaves the workspace exactly as it was. The caller is
 * responsible for having confirmed a `replace` with the user.
 */
export function applyValidatedBackup(
  database: DatabaseSync,
  document: BackupDocument,
  mode: BackupImportMode,
): BackupApplyOutcome {
  const result = mode === 'replace' ? replaceWith(database, document) : mergeInto(database, document)

  return {
    outcome: 'applied',
    mode,
    counts: result.counts,
    unchanged: result.unchanged,
    conflicts: result.conflicts,
    preferences: document.preferences ?? null,
  }
}

// ---------------------------------------------------------------------------
// exporting
// ---------------------------------------------------------------------------

/**
 * True when two documents describe exactly the same records, field for field.
 *
 * Used to check an export by reading it back: the file must say what the
 * snapshot said, or it is not a backup of this workspace.
 */
function sameWorkspace(left: BackupDocument, right: BackupDocument): boolean {
  return sourceMapsEqual(foldWorkspace(sourceOf(left)), foldWorkspace(sourceOf(right)))
}

/**
 * Maps a thrown error to the storage vocabulary the renderer already explains.
 *
 * Filesystem errors are read through their `code` first — SQLite and POSIX do
 * not share one — and anything unrecognised falls through to the database
 * classifier, which leaves it `unknown` rather than guessing.
 */
export function classifyBackupFailure(error: unknown): StorageErrorKind {
  const code = (error as { readonly code?: unknown } | null | undefined)?.code

  if (code === 'ENOSPC' || code === 'EDQUOT') {
    return 'quota'
  }

  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'EBUSY') {
    return 'unavailable'
  }

  return classifyDatabaseError(error)
}

/** The filename part of a path, for the success message. */
export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export type ExportBackupOptions = {
  readonly database: DatabaseSync
  readonly dialogs: BackupDialogs
  readonly files: BackupFiles
  readonly appVersion: string
  /** Preferences to attach, already sanitised, or `null` to omit them. */
  readonly preferences: BackupPreferences | null
}

/**
 * Writes the whole workspace to a file the user chooses.
 *
 * The order is deliberate at every step:
 *
 *   1. snapshot inside a transaction, so the document's counts and its records
 *      describe one moment;
 *   2. ask the user *after* the snapshot, so a long dialog cannot let the data
 *      move on behind it;
 *   3. write atomically, so the path is never a partial file;
 *   4. read the file back, validate it and compare it to the snapshot — an
 *      export that cannot be read back is not a backup, and is removed rather
 *      than left behind pretending to be one.
 *
 * Archive rows that could not be read out of the database are counted and
 * reported, never silently dropped: the file is honest about what it does not
 * contain, and the Settings page can point at "Export unreadable data".
 */
export async function exportBackup(options: ExportBackupOptions): Promise<BackupExportOutcome> {
  const { database, dialogs, files, appVersion, preferences } = options

  let built: { readonly document: BackupDocument; readonly unreadableArchiveRows: number }

  try {
    built = buildBackupDocument(database, appVersion, preferences)
  } catch (error) {
    return { outcome: 'failed', kind: classifyBackupFailure(error) }
  }

  let path: string | null

  try {
    path = await dialogs.showSave(backupFileName(new Date()))
  } catch (error) {
    return { outcome: 'failed', kind: classifyBackupFailure(error) }
  }

  if (path === null) {
    return { outcome: 'cancelled' }
  }

  const contents = `${JSON.stringify(built.document, null, 2)}\n`

  try {
    files.writeAtomic(path, contents)
  } catch (error) {
    // `writeAtomic` leaves the original file (if the user chose to overwrite
    // one) untouched when it fails, so there is nothing of ours to remove.
    return { outcome: 'failed', kind: classifyBackupFailure(error) }
  }

  try {
    const reread = parseBackupText(files.read(path))

    if (!reread.ok || !sameWorkspace(built.document, reread.document)) {
      // The path now holds what we just wrote, replacing whatever was there
      // before — the user already consented to that overwrite. A file that
      // cannot be read back as this workspace is not a backup, so it is
      // removed rather than left to be mistaken for one.
      files.remove(path)
      return { outcome: 'failed', kind: 'unknown' }
    }

    return {
      outcome: 'written',
      path,
      fileName: fileNameOf(path),
      counts: built.document.counts,
      bytes: files.size(path),
      unreadableArchiveRows: built.unreadableArchiveRows,
      preferencesIncluded: built.document.preferences !== undefined,
    }
  } catch (error) {
    files.remove(path)
    return { outcome: 'failed', kind: classifyBackupFailure(error) }
  }
}
