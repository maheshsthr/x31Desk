/**
 * x31Desk — the main process's migration IPC handlers.
 * ---------------------------------------------------------------------------
 * Two channels: one reports whether the one-time `localStorage` import has
 * finished, the other performs it. Neither is a repository operation, so they
 * live apart from `repositoryHandlers.ts` and are registered by their own
 * function.
 *
 * The import handler never throws. A malformed payload, an unavailable database,
 * a conflict and a verification failure are all reported as a typed
 * {@link MigrationOutcome}; only an unexpected database error is reduced to a
 * `StorageErrorKind` — the same vocabulary the renderer's repository adapters
 * already understand. No SQLite message, SQL or database path is ever part of a
 * response.
 *
 * The handlers are registered whether or not the database is open, exactly like
 * the repository handlers: a status call on a closed database answers
 * `unavailable` rather than rejecting.
 */

import type { IpcMain, IpcMainInvokeEvent } from 'electron'

import { IPC_CHANNELS, type MigrationOutcome, type MigrationStatusResult } from '@/data/ipc/contract'
import { classifyDatabaseError } from '../db/errorKind.ts'
import { importWorkspace, readMigrationStatus } from '../db/migration.ts'
import type { DatabaseProvider } from './repositoryHandlers.ts'
import { parseMigrationImport } from './validation.ts'

/** The two migration handlers, taking the raw `invoke` arguments. */
export type MigrationHandlers = {
  readonly status: () => MigrationStatusResult
  readonly import: (args: readonly unknown[]) => MigrationOutcome
}

/** Builds the migration handlers against a database provider. */
export function createMigrationHandlers(getDatabase: DatabaseProvider): MigrationHandlers {
  function status(): MigrationStatusResult {
    const database = getDatabase()

    if (database === null) {
      return { status: 'unavailable' }
    }

    try {
      return readMigrationStatus(database)
    } catch (error) {
      console.error('[x31desk] migration status failed:', error)

      return { status: 'unavailable' }
    }
  }

  function importSource(args: readonly unknown[]): MigrationOutcome {
    if (args.length !== 1) {
      console.error(`[x31desk] rejected ${IPC_CHANNELS.migrationImport}: expected one argument`)

      return { outcome: 'invalid-source', collections: [] }
    }

    const input = parseMigrationImport(args[0])

    if (input === null) {
      console.error(`[x31desk] rejected ${IPC_CHANNELS.migrationImport}: payload failed validation`)

      return { outcome: 'invalid-source', collections: [] }
    }

    const database = getDatabase()

    if (database === null) {
      return { outcome: 'unavailable' }
    }

    try {
      return importWorkspace(database, input.source)
    } catch (error) {
      console.error('[x31desk] migration import failed:', error)

      return { outcome: 'failed', kind: classifyDatabaseError(error) }
    }
  }

  return { status, import: importSource }
}

/**
 * Registers the migration handlers on the given `ipcMain`, reading the current
 * database through `getDatabase` on each call.
 */
export function registerMigrationHandlers(ipcMain: IpcMain, getDatabase: DatabaseProvider): void {
  const handlers = createMigrationHandlers(getDatabase)

  ipcMain.handle(IPC_CHANNELS.migrationStatus, () => handlers.status())
  ipcMain.handle(IPC_CHANNELS.migrationImport, (_event: IpcMainInvokeEvent, ...args: unknown[]) =>
    handlers.import(args),
  )
}
