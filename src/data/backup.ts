/**
 * x31Desk — the renderer's half of backup and restore.
 * ---------------------------------------------------------------------------
 * The main process owns the database and the file dialogs; the renderer owns the
 * Settings page and, in the desktop shell, `localStorage`. So the flow is split
 * exactly along that line:
 *
 *   * `runBackupExport` flushes pending saves, hands the main process the
 *     preferences to attach, and lets it drive the save dialog and write;
 *   * `runBackupInspect` lets the main process drive the open dialog and returns
 *     a *preview* for a confirmation step, plus the validated document;
 *   * `runBackupImport` hands that document back with the mode the user chose,
 *     then applies the returned preferences to `localStorage` and reports
 *     whether the page needs reloading.
 *
 * Three properties run through the module:
 *
 *   * **Nothing is written before the user has seen the preview.** The document
 *     that comes back from inspect is passed straight through; the renderer
 *     never edits it, and the main process re-validates it on the way in.
 *   * **Pending edits are flushed before an export.** The queue is awaited so a
 *     debounced change the user typed a moment ago is in the file; if it cannot
 *     be flushed, the export is refused rather than quietly written without it.
 *   * **A no-op says so.** A merge that wrote nothing — every record already
 *     present, no preference to restore — is reported as a no-op, so the page
 *     can say "Nothing to import" instead of reloading the window for nothing.
 *
 * In a browser there is no bridge and every entry point reports `unsupported`,
 * which the Settings page renders as an explanation rather than a dead button.
 */

import {
  type BackupApplyOutcome,
  type BackupConflict,
  type BackupDocument,
  type BackupExportOutcome,
  type BackupImportMode,
  type BackupInspectOutcome,
  type BackupPreferences,
  type BackupPreview,
  type MigrationRecordCounts,
} from '@/data/ipc/contract'
import { saveQueue as defaultSaveQueue, type SaveQueue } from '@/data/saveQueue'
import { storageErrorMessage } from '@/data/storageError'
import { STORAGE_KEYS } from '@/data/storageKeys'
import type { DesktopBackupBridge } from '@/types/desktop'
import {
  isThemePreference,
  type ThemePreference,
} from '@/types/theme'
import {
  sanitizeEditorPreferences,
  type EditorPreferences,
} from '@/types/editorPreferences'

/** The bridge, when the renderer is running inside the Electron shell. */
function desktopBackup(): DesktopBackupBridge | undefined {
  return window.x31deskDesktop?.backup
}

/** The four collection counts as a single number. */
export function totalRecords(counts: MigrationRecordCounts): number {
  return counts.notes + counts.tasks + counts.snippets + counts.archive
}

/** "12 notes, 3 tasks, 1 snippet and 2 archived items" — skipping empty lists. */
export function describeCounts(counts: MigrationRecordCounts): string {
  const parts: string[] = []

  if (counts.notes > 0) {
    parts.push(`${counts.notes} ${counts.notes === 1 ? 'note' : 'notes'}`)
  }

  if (counts.tasks > 0) {
    parts.push(`${counts.tasks} ${counts.tasks === 1 ? 'task' : 'tasks'}`)
  }

  if (counts.snippets > 0) {
    parts.push(`${counts.snippets} ${counts.snippets === 1 ? 'snippet' : 'snippets'}`)
  }

  if (counts.archive > 0) {
    parts.push(
      `${counts.archive} ${counts.archive === 1 ? 'archived item' : 'archived items'}`,
    )
  }

  if (parts.length === 0) {
    return 'nothing'
  }

  if (parts.length === 1) {
    return parts[0]
  }

  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** "1 and 2" — joining conflict ids for the message that lists them. */
function joinConflicts(conflicts: readonly BackupConflict[], limit: number): string {
  const shown = conflicts.slice(0, limit).map((conflict) => conflict.id)

  if (conflicts.length > limit) {
    shown.push(`and ${conflicts.length - limit} more`)
  }

  return shown.join(', ')
}

// ---------------------------------------------------------------------------
// preferences
// ---------------------------------------------------------------------------

/** Reads the theme preference, or `null` when the key holds nothing usable. */
function readStoredTheme(storage: Storage): ThemePreference | null {
  try {
    const stored = storage.getItem(STORAGE_KEYS.theme)
    return isThemePreference(stored) ? stored : null
  } catch {
    // An unreadable key contributes no preference; the rest may still read.
    return null
  }
}

/** Reads the editor preferences, or `null` when the key holds nothing usable. */
function readStoredEditor(storage: Storage): EditorPreferences | null {
  try {
    const raw = storage.getItem(STORAGE_KEYS.editor)

    if (raw === null || raw === '') {
      return null
    }

    return sanitizeEditorPreferences(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

/**
 * Reads the preferences an export attaches.
 *
 * Each is optional and independent: a key that is missing or unusable simply
 * does not contribute, and when nothing contributes the result is `null` so the
 * document omits the section entirely rather than carrying an empty one.
 *
 * Only preferences are read — never the workspace collections. They live in
 * `localStorage`; the records live in SQLite, in the main process. A key left
 * behind by a retired setting (the old UI-scale key) is not read, so it
 * never re-enters a newly written backup.
 */
export function readBackupPreferences(storage: Storage = window.localStorage): BackupPreferences | null {
  const theme = readStoredTheme(storage)
  const editor = readStoredEditor(storage)

  if (theme === null && editor === null) {
    return null
  }

  return {
    ...(theme === null ? {} : { theme }),
    ...(editor === null ? {} : { editor }),
  }
}

/**
 * Writes the preferences an import returned into `localStorage`.
 *
 * The main process has no access to `localStorage`, so the renderer is the one
 * that can apply them. Each key is written only if the document carried it, and
 * only if its value differs from what is stored — so "restore" never reports
 * success for a change that did nothing. Absent keys leave the workspace's
 * current setting alone, which is what makes importing an older backup safe:
 * preferences this build no longer understands are dropped upstream and never
 * reach here, so they cannot displace a setting the user has since changed.
 *
 * Returns whether anything actually changed.
 */
export function applyBackupPreferences(
  preferences: BackupPreferences | null,
  storage: Storage = window.localStorage,
): boolean {
  if (preferences === null) {
    return false
  }

  let changed = false

  if (preferences.theme !== undefined && isThemePreference(preferences.theme)) {
    changed = writeKey(storage, STORAGE_KEYS.theme, preferences.theme) || changed
  }

  if (preferences.editor !== undefined) {
    const next = sanitizeEditorPreferences(preferences.editor)
    changed = writeKey(storage, STORAGE_KEYS.editor, JSON.stringify(next)) || changed
  }

  return changed
}

/**
 * Writes one key when it differs from what is stored.
 *
 * Comparing first is what lets an import honestly report "nothing changed"
 * rather than claiming a restoration that left every value as it was. A failure
 * to write is not an error: the records have already been imported, and a
 * preference that will not persist should not undo that.
 */
function writeKey(storage: Storage, key: string, serialised: string): boolean {
  try {
    if (storage.getItem(key) === serialised) {
      return false
    }

    storage.setItem(key, serialised)

    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// reports
// ---------------------------------------------------------------------------

/** What the Settings page needs to describe an export. */
export type BackupExportReport =
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'written'
      readonly fileName: string
      readonly counts: MigrationRecordCounts
      /** Rows the file could not carry; they stay in the database, untouched. */
      readonly unreadableArchiveRows: number
      readonly preferencesIncluded: boolean
    }
  | { readonly kind: 'failed'; readonly message: string }

/** What the Settings page needs to show the import preview. */
export type BackupInspectReport =
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'ready'
      readonly fileName: string
      readonly preview: BackupPreview
      /** Passed straight back to `runBackupImport`; never edited here. */
      readonly document: BackupDocument
    }
  | { readonly kind: 'rejected'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }

/** What the Settings page needs to describe an import. */
export type BackupImportReport =
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'rejected'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }
  | {
      readonly kind: 'applied'
      readonly mode: BackupImportMode
      /** Records the workspace gained. */
      readonly added: MigrationRecordCounts
      readonly conflicts: readonly BackupConflict[]
      /** Whether preferences were restored *and* differed from the current ones. */
      readonly preferencesRestored: boolean
      /** Whether a merge had nothing at all to do. */
      readonly noop: boolean
      /** Whether the window must be reloaded for the change to be visible. */
      readonly needsReload: boolean
      readonly message: string
    }

/** Options for each entry point, all injectable for tests. */
export type BackupCallOptions = {
  readonly bridge?: DesktopBackupBridge
  readonly storage?: Storage
  readonly queue?: SaveQueue
}

// ---------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------

/**
 * Runs an export end to end and reports it.
 *
 * The save queue is flushed first: a debounced edit that has not reached the
 * database yet would otherwise be missing from the file, and "Back up my work"
 * must not mean "back up your work up to a second ago". A flush that fails
 * refuses the export rather than writing a file that is silently incomplete.
 *
 * Never throws — a rejected bridge call becomes a `failed` report with the
 * message its {@link StorageErrorKind} already explains.
 */
export async function runBackupExport(
  options: BackupCallOptions = {},
): Promise<BackupExportReport> {
  const bridge = options.bridge ?? desktopBackup()

  if (bridge === undefined) {
    return { kind: 'unsupported' }
  }

  const queue = options.queue ?? defaultSaveQueue

  try {
    await queue.flushAll()
  } catch {
    return {
      kind: 'failed',
      message: 'The latest changes could not be saved, so no backup was taken.',
    }
  }

  let outcome: BackupExportOutcome

  try {
    outcome = await bridge.create({
      preferences: readBackupPreferences(options.storage) ?? undefined,
    })
  } catch {
    return { kind: 'failed', message: 'The backup could not be written.' }
  }

  switch (outcome.outcome) {
    case 'cancelled':
      return { kind: 'cancelled' }

    case 'written':
      return {
        kind: 'written',
        fileName: outcome.fileName,
        counts: outcome.counts,
        unreadableArchiveRows: outcome.unreadableArchiveRows,
        preferencesIncluded: outcome.preferencesIncluded,
      }

    case 'failed':
      return {
        kind: 'failed',
        message: storageErrorMessage(outcome.kind, 'The backup could not be written.'),
      }
  }
}

/**
 * Opens the picker and validates the chosen file, without writing anything.
 *
 * The document that comes back has been validated by the main process and is
 * handed straight through: the renderer shows counts, never edits the payload,
 * and passes it back unchanged when the user confirms.
 */
export async function runBackupInspect(
  options: BackupCallOptions = {},
): Promise<BackupInspectReport> {
  const bridge = options.bridge ?? desktopBackup()

  if (bridge === undefined) {
    return { kind: 'unsupported' }
  }

  let outcome: BackupInspectOutcome

  try {
    outcome = await bridge.inspect()
  } catch {
    return { kind: 'failed', message: 'The backup file could not be read.' }
  }

  switch (outcome.outcome) {
    case 'cancelled':
      return { kind: 'cancelled' }

    case 'ready':
      return {
        kind: 'ready',
        fileName: outcome.fileName,
        preview: outcome.preview,
        document: outcome.document,
      }

    case 'rejected':
      return { kind: 'rejected', message: outcome.message }

    case 'failed':
      return {
        kind: 'failed',
        message: storageErrorMessage(outcome.kind, 'The backup file could not be read.'),
      }
  }
}

/** Options for {@link runBackupImport}. */
export type BackupImportOptions = BackupCallOptions & {
  readonly mode: BackupImportMode
  readonly document: BackupDocument
}

/**
 * Applies an inspected document and reports what the workspace gained.
 *
 * The mode is the user's decision, reached through the preview step; nothing
 * here decides it. On success the returned preferences are written into
 * `localStorage`, which is the only place they can be applied from.
 */
export async function runBackupImport(
  options: BackupImportOptions,
): Promise<BackupImportReport> {
  const bridge = options.bridge ?? desktopBackup()

  if (bridge === undefined) {
    return { kind: 'unsupported' }
  }

  let outcome: BackupApplyOutcome

  try {
    outcome = await bridge.apply({ document: options.document, mode: options.mode })
  } catch {
    return { kind: 'failed', message: 'The backup could not be imported.' }
  }

  switch (outcome.outcome) {
    case 'rejected':
      return { kind: 'rejected', message: outcome.message }

    case 'failed':
      return {
        kind: 'failed',
        message: storageErrorMessage(outcome.kind, 'The backup could not be imported.'),
      }

    case 'applied':
      return describeApplied(outcome, options.storage)
  }
}

/** Turns an applied outcome into the report the Settings page shows. */
function describeApplied(
  outcome: Extract<BackupApplyOutcome, { outcome: 'applied' }>,
  storage: Storage | undefined,
): BackupImportReport {
  const preferencesRestored = applyBackupPreferences(outcome.preferences, storage)
  const added = totalRecords(outcome.counts)
  const replaced = outcome.mode === 'replace'
  // "Nothing happened" is decided by what was *written*, not by what was
  // reported. A merge whose every record was already here wrote nothing, so
  // reloading the window would only show the user the same workspace again —
  // and a replace always writes, however small the backup is.
  const wroteNothing = added === 0 && !preferencesRestored
  const noop = !replaced && wroteNothing

  return {
    kind: 'applied',
    mode: outcome.mode,
    added: outcome.counts,
    conflicts: outcome.conflicts,
    preferencesRestored,
    noop,
    needsReload: replaced || !wroteNothing,
    message: describeImport(outcome, added, noop, preferencesRestored),
  }
}

/** The sentence shown once an import has been applied. */
function describeImport(
  outcome: Extract<BackupApplyOutcome, { outcome: 'applied' }>,
  added: number,
  noop: boolean,
  preferencesRestored: boolean,
): string {
  const conflictCount = outcome.conflicts.length

  if (noop && conflictCount === 0) {
    return 'Nothing to import — this workspace already matches that backup.'
  }

  if (noop) {
    return `${conflictCount} ${conflictCount === 1 ? 'record was' : 'records were'} already in this workspace with different content and ${conflictCount === 1 ? 'was' : 'were'} kept as they are. Nothing was changed.`
  }

  const pieces: string[] = []

  if (outcome.mode === 'replace') {
    pieces.push(
      `Restored ${describeCounts(outcome.counts)} from the backup, replacing everything that was there.`,
    )
  } else if (added > 0) {
    pieces.push(`Imported ${describeCounts(outcome.counts)}.`)
  } else {
    pieces.push('No new records to import.')
  }

  if (conflictCount > 0) {
    pieces.push(
      `${conflictCount} ${conflictCount === 1 ? 'record was' : 'records were'} already in this workspace with different content and ${conflictCount === 1 ? 'was' : 'were'} kept as they are (id${conflictCount === 1 ? '' : 's'} ${joinConflicts(outcome.conflicts, 4)}).`,
    )
  }

  if (preferencesRestored) {
    pieces.push('Your preferences were restored.')
  }

  return pieces.join(' ')
}
