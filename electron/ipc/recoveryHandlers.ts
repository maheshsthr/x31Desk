/**
 * x31Desk — the main process's recovery IPC handlers.
 * ---------------------------------------------------------------------------
 * One read-only channel: the archive corruption vault. It is not a repository
 * operation — no `ArchiveRepository` method reads the vault back — so it lives
 * apart from `repositoryHandlers.ts` and is registered by its own function,
 * exactly like the migration handlers.
 *
 * The vault is where the SQLite archive adapter copies a row it could not read
 * back, before leaving it out of `list()`. Reading it here is what lets the
 * Settings page offer the bytes for export; nothing on this channel writes,
 * moves or deletes an entry, so a recovery export can never disturb the data it
 * reports.
 *
 * The handler is registered whether or not the database is open. On a closed
 * database it answers `unavailable` rather than rejecting, so the renderer sees
 * a failure in the storage vocabulary it already understands.
 */

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { DatabaseSync } from 'node:sqlite'

import {
  IPC_CHANNELS,
  type ArchiveCorruptionEntry,
  type IpcResult,
} from '@/data/ipc/contract'

import { createArchiveQuarantine, type ArchiveQuarantine } from '../db/archiveQuarantine.ts'
import { classifyDatabaseError } from '../db/errorKind.ts'
import type { DatabaseProvider } from './repositoryHandlers.ts'

/** The recovery handlers, taking the raw `invoke` arguments. */
export type RecoveryHandlers = {
  readonly archiveCorruption: (args: readonly unknown[]) => Promise<IpcResult<ArchiveCorruptionEntry[]>>
}

/** Builds the recovery handlers against a database provider. */
export function createRecoveryHandlers(getDatabase: DatabaseProvider): RecoveryHandlers {
  let cachedConnection: DatabaseSync | null = null
  let cachedQuarantine: ArchiveQuarantine | null = null

  /** Binds the vault once per connection, so its statements are reused. */
  function quarantineFor(database: DatabaseSync): ArchiveQuarantine {
    if (cachedQuarantine === null || cachedConnection !== database) {
      cachedConnection = database
      cachedQuarantine = createArchiveQuarantine(database)
    }

    return cachedQuarantine
  }

  async function archiveCorruption(
    args: readonly unknown[],
  ): Promise<IpcResult<ArchiveCorruptionEntry[]>> {
    if (args.length !== 0) {
      console.error(
        `[x31desk] rejected ${IPC_CHANNELS.archiveCorruption}: expected no arguments, received ${args.length}`,
      )

      return { ok: false, kind: 'unknown' }
    }

    const database = getDatabase()

    if (database === null) {
      return { ok: false, kind: 'unavailable' }
    }

    try {
      // Every field is a string or number, so the entries cross the IPC boundary
      // as structured-cloneable values with nothing left to serialise.
      return { ok: true, value: quarantineFor(database).list() }
    } catch (error) {
      console.error('[x31desk] archive corruption read failed:', error)

      return { ok: false, kind: classifyDatabaseError(error) }
    }
  }

  return { archiveCorruption }
}

/**
 * Registers the recovery handlers on the given `ipcMain`, reading the current
 * database through `getDatabase` on each call.
 */
export function registerRecoveryHandlers(ipcMain: IpcMain, getDatabase: DatabaseProvider): void {
  const handlers = createRecoveryHandlers(getDatabase)

  ipcMain.handle(IPC_CHANNELS.archiveCorruption, (_event: IpcMainInvokeEvent, ...args: unknown[]) =>
    handlers.archiveCorruption(args),
  )
}
