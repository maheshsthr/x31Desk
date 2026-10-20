/**
 * x31Desk — the main process's backup and restore IPC handlers.
 * ---------------------------------------------------------------------------
 * Three channels, one per step of the flow:
 *
 *   * `backup.export`  — snapshot the workspace and write it to a file the user
 *     chooses in a native save dialog;
 *   * `backup.inspect` — open a native picker, read and *validate* the chosen
 *     file, and return its preview plus the validated document;
 *   * `backup.apply`   — take that document back and merge or replace.
 *
 * The split matters. Nothing is written to the database until `apply`, and
 * `apply` re-validates the document it is handed because the renderer is not to
 * be trusted with it: the value arriving here has crossed the IPC boundary.
 * Reading validates; writing validates again. Neither trusts the other.
 *
 * Like the migration handlers, these never throw. Cancelling a dialog, refusing
 * a file, merging, replacing and succeeding are all *decisions* and are reported
 * as typed outcomes; only an unexpected filesystem or database error is reduced
 * to a {@link StorageErrorKind}. No SQLite message, SQL, or database path ever
 * crosses back — the one path that does is the one the user chose themselves.
 *
 * Both the native dialogs and the filesystem are injected. That keeps this
 * module free of `electron` and `node:fs` at import time, so it loads under the
 * plain Node test runner, and the real dialog is wired only in `main.ts`.
 */

import type { IpcMain, IpcMainInvokeEvent } from 'electron'

import {
  IPC_CHANNELS,
  type BackupApplyOutcome,
  type BackupExportOutcome,
  type BackupImportMode,
  type BackupInspectOutcome,
  type BackupPreferences,
} from '@/data/ipc/contract'
import {
  applyValidatedBackup,
  BackupVerificationError,
  backupRejectionMessage,
  classifyBackupFailure,
  exportBackup,
  fileNameOf,
  MAX_BACKUP_BYTES,
  parseBackupText,
  sanitizeBackupPreferences,
  validateBackupDocument,
  type BackupDialogs,
  type BackupFiles,
} from '../db/backup.ts'
import { nodeBackupFiles } from '../db/backupFiles.ts'
import type { DatabaseProvider } from './repositoryHandlers.ts'

/** What an export request carries, once parsed. */
type ExportRequest = { readonly preferences: BackupPreferences | null }

/** What an apply request carries, once parsed. */
type ApplyRequest = { readonly document: unknown; readonly mode: BackupImportMode }

/** Everything the backup handlers need from the shell. */
export type BackupHandlerOptions = {
  /** Reads the current database; `null` while it is closed or unopenable. */
  readonly getDatabase: DatabaseProvider
  /** The native save/open dialogs. */
  readonly dialogs: BackupDialogs
  /** Filesystem access. Defaults to the real one; injected in tests. */
  readonly files?: BackupFiles
  /** The application version recorded in the document. */
  readonly appVersion: string
}

/** The three backup handlers, taking the raw `invoke` arguments. */
export type BackupHandlers = {
  readonly export: (args: readonly unknown[]) => Promise<BackupExportOutcome>
  readonly inspect: () => Promise<BackupInspectOutcome>
  readonly apply: (args: readonly unknown[]) => BackupApplyOutcome
}

/**
 * Reads an export request's preferences.
 *
 * Preferences are optional and, for an export, best-effort: a request that
 * carries none, or carries a value that cannot be sanitised, simply produces a
 * document with no preferences rather than a failure. The user asked for a
 * backup of their data; a theme value is not worth refusing it over.
 */
export function parseExportRequest(value: unknown): ExportRequest | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (candidate.preferences === undefined || candidate.preferences === null) {
    return { preferences: null }
  }

  return { preferences: sanitizeBackupPreferences(candidate.preferences) }
}

/**
 * Reads an apply request.
 *
 * The mode is checked here because it selects a destructive path; the document
 * is passed through untouched and validated by the caller, which is the same
 * routine that judged the file in the first place.
 */
export function parseApplyRequest(value: unknown): ApplyRequest | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (candidate.mode !== 'merge' && candidate.mode !== 'replace') {
    return null
  }

  if (candidate.document === undefined) {
    return null
  }

  return { document: candidate.document, mode: candidate.mode }
}

/** Builds the backup handlers against a database provider and the shell's ports. */
export function createBackupHandlers(options: BackupHandlerOptions): BackupHandlers {
  const { getDatabase, dialogs, appVersion } = options
  const files = options.files ?? nodeBackupFiles

  async function exportRequest(args: readonly unknown[]): Promise<BackupExportOutcome> {
    if (args.length !== 1) {
      console.error(`[x31desk] rejected ${IPC_CHANNELS.backupExport}: expected one argument`)

      return { outcome: 'failed', kind: 'unknown' }
    }

    const request = parseExportRequest(args[0])

    if (request === null) {
      console.error(`[x31desk] rejected ${IPC_CHANNELS.backupExport}: payload failed validation`)

      return { outcome: 'failed', kind: 'unknown' }
    }

    const database = getDatabase()

    if (database === null) {
      return { outcome: 'failed', kind: 'unavailable' }
    }

    return exportBackup({ database, dialogs, files, appVersion, preferences: request.preferences })
  }

  async function inspectRequest(): Promise<BackupInspectOutcome> {
    // The database is checked before the picker opens. Reading and validating a
    // file does not need it, but the user cannot *use* what they find without
    // it, and finding that out after they have chosen a file is two wasted
    // steps rather than one.
    if (getDatabase() === null) {
      return { outcome: 'failed', kind: 'unavailable' }
    }

    let path: string | null

    try {
      path = await dialogs.showOpen()
    } catch (error) {
      console.error('[x31desk] backup open dialog failed:', error)

      return { outcome: 'failed', kind: classifyBackupFailure(error) }
    }

    if (path === null) {
      return { outcome: 'cancelled' }
    }

    try {
      // The size is checked before the file is read: an oversized file is
      // refused on its metadata rather than loaded into memory first.
      if (files.size(path) > MAX_BACKUP_BYTES) {
        return { outcome: 'rejected', reason: 'too-large', message: backupRejectionMessage('too-large') }
      }

      const validation = parseBackupText(files.read(path))

      if (!validation.ok) {
        return { outcome: 'rejected', reason: validation.reason, message: validation.message }
      }

      return {
        outcome: 'ready',
        fileName: fileNameOf(path),
        preview: validation.preview,
        document: validation.document,
      }
    } catch (error) {
      console.error('[x31desk] backup inspect failed:', error)

      return { outcome: 'failed', kind: classifyBackupFailure(error) }
    }
  }

  function applyRequest(args: readonly unknown[]): BackupApplyOutcome {
    if (args.length !== 1) {
      console.error(`[x31desk] rejected ${IPC_CHANNELS.backupApply}: expected one argument`)

      return {
        outcome: 'rejected',
        reason: 'malformed',
        message: 'The import request was not understood.',
      }
    }

    const request = parseApplyRequest(args[0])

    if (request === null) {
      console.error(`[x31desk] rejected ${IPC_CHANNELS.backupApply}: payload failed validation`)

      return {
        outcome: 'rejected',
        reason: 'malformed',
        message: 'The import request was not understood.',
      }
    }

    const validation = validateBackupDocument(request.document)

    if (!validation.ok) {
      return { outcome: 'rejected', reason: validation.reason, message: validation.message }
    }

    const database = getDatabase()

    if (database === null) {
      return { outcome: 'failed', kind: 'unavailable' }
    }

    try {
      return applyValidatedBackup(database, validation.document, request.mode)
    } catch (error) {
      console.error('[x31desk] backup apply failed:', error)

      // A verification failure is thrown from inside the transaction, which has
      // already rolled back; the workspace is intact, so this is an ordinary
      // failure to report rather than a reason to escalate.
      if (error instanceof BackupVerificationError) {
        return { outcome: 'failed', kind: 'unknown' }
      }

      return { outcome: 'failed', kind: classifyBackupFailure(error) }
    }
  }

  return { export: exportRequest, inspect: inspectRequest, apply: applyRequest }
}

/**
 * Registers the backup handlers on the given `ipcMain`, reading the current
 * database through `getDatabase` on each call.
 */
export function registerBackupHandlers(ipcMain: IpcMain, options: BackupHandlerOptions): void {
  const handlers = createBackupHandlers(options)

  ipcMain.handle(IPC_CHANNELS.backupExport, (_event: IpcMainInvokeEvent, ...args: unknown[]) =>
    handlers.export(args),
  )
  ipcMain.handle(IPC_CHANNELS.backupInspect, () => handlers.inspect())
  ipcMain.handle(IPC_CHANNELS.backupApply, (_event: IpcMainInvokeEvent, ...args: unknown[]) =>
    handlers.apply(args),
  )
}
