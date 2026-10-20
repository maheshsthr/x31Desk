/**
 * x31Desk — the main process's SQLite database.
 * ---------------------------------------------------------------------------
 * The database is owned exclusively by the main process. Nothing here is
 * reachable from the renderer: there is no channel that runs SQL and no path
 * that crosses the IPC boundary. A renderer only ever sees the record shapes
 * the future repository adapters will return.
 *
 * SQLite itself is Node's built-in `node:sqlite`, which Electron's bundled Node
 * ships, so the database costs no dependency and needs no native rebuild. Its
 * API is synchronous, which is a good fit here: a mutation completes before its
 * handler returns, so the main process is a single writer and no two operations
 * interleave.
 *
 * Initialisation is explicit and all-or-nothing. {@link initializeDatabase}
 * either returns a migrated, usable handle or throws a
 * {@link DatabaseInitError} — it never hands back a half-open connection or
 * leaves a caller believing the database is ready when it is not.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { DATABASE_MIGRATIONS, type DatabaseMigration } from './schema.ts'

/** The database file name inside the application's user-data directory. */
export const DATABASE_FILENAME = 'x31desk.db'

/**
 * Why the database could not be brought to a usable state.
 *
 * Kept small and closed so a caller can react to the condition rather than
 * parse a message: `newer-schema` means the file was written by a later build
 * and must not be downgraded; the others mean the file or its directory could
 * not be prepared.
 */
export type DatabaseInitErrorCode =
  | 'directory-unavailable'
  | 'open-failed'
  | 'migration-failed'
  | 'newer-schema'

/** A database that could not be opened, migrated or trusted. */
export class DatabaseInitError extends Error {
  readonly code: DatabaseInitErrorCode

  constructor(code: DatabaseInitErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DatabaseInitError'
    this.code = code
  }
}

/** A live, migrated database connection and the file it is backed by. */
export type AppDatabase = {
  /** The open connection. Owned by the caller; do not share it with a renderer. */
  readonly connection: DatabaseSync
  /** The absolute path of the database file. */
  readonly filePath: string
  /** The structural version the file is at, matching `PRAGMA user_version`. */
  readonly version: number
  /** Closes the connection. Safe to call once. */
  close: () => void
}

/** Reads the database's structural version from `PRAGMA user_version`. */
export function readDatabaseVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get()
  const value = row?.['user_version']

  return typeof value === 'number' ? value : 0
}

/** Requires the migration list to be a strictly sequential chain from 1. */
function assertMigrationChain(migrations: readonly DatabaseMigration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `database migrations must be sequential from 1; found version ${migration.version} at index ${index}`,
      )
    }
  })
}

/**
 * Applies every migration newer than the file's current version, each in its
 * own transaction, and advances `PRAGMA user_version` only after that step's
 * statements succeed. A step that throws is rolled back in full, so a failed
 * migration cannot leave a partially created schema behind, and the file stays
 * at the last version that genuinely completed.
 *
 * Returns the version the database is at once the chain has been applied.
 */
export function runMigrations(
  database: DatabaseSync,
  migrations: readonly DatabaseMigration[] = DATABASE_MIGRATIONS,
): number {
  assertMigrationChain(migrations)

  const targetVersion = migrations[migrations.length - 1]?.version ?? 0
  const currentVersion = readDatabaseVersion(database)

  // A file from a later build is not something this build can understand. It is
  // reported rather than opened, because downgrading would risk its data.
  if (currentVersion > targetVersion) {
    throw new DatabaseInitError(
      'newer-schema',
      `the database is at schema version ${currentVersion}, but this build only understands version ${targetVersion}`,
    )
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue
    }

    database.exec('BEGIN IMMEDIATE')

    try {
      migration.up(database)
      database.exec(`PRAGMA user_version = ${migration.version}`)
      database.exec('COMMIT')
    } catch (error) {
      try {
        database.exec('ROLLBACK')
      } catch {
        // The transaction had already been rolled back; there is nothing to do.
      }

      throw new DatabaseInitError(
        'migration-failed',
        `schema migration ${migration.version} (${migration.description}) failed and was rolled back`,
        { cause: error },
      )
    }
  }

  return readDatabaseVersion(database)
}

/**
 * Opens the database in `directory`, applies durability and foreign-key
 * settings, and runs the migration chain.
 *
 * The connection is configured once, here, so every later query inherits it:
 * write-ahead logging for crash safety, `synchronous = FULL` so a committed
 * write is flushed before the call returns, foreign-key enforcement so the
 * child tables' `REFERENCES` are real, and a busy timeout for the rare case of
 * another connection holding a lock.
 *
 * Throws {@link DatabaseInitError} on any failure. The caller decides what to
 * do — it must not treat the database as ready.
 */
export function initializeDatabase(directory: string): AppDatabase {
  let filePath: string

  try {
    mkdirSync(directory, { recursive: true })
    filePath = join(directory, DATABASE_FILENAME)
  } catch (error) {
    throw new DatabaseInitError(
      'directory-unavailable',
      `could not prepare the database directory "${directory}"`,
      { cause: error },
    )
  }

  let connection: DatabaseSync

  try {
    connection = new DatabaseSync(filePath, {
      enableForeignKeyConstraints: true,
      timeout: 5000,
    })
  } catch (error) {
    throw new DatabaseInitError(
      'open-failed',
      `could not open the database at "${filePath}"`,
      { cause: error },
    )
  }

  try {
    connection.exec('PRAGMA journal_mode = WAL')
    connection.exec('PRAGMA synchronous = FULL')

    const version = runMigrations(connection)

    return {
      connection,
      filePath,
      version,
      close: () => {
        connection.close()
      },
    }
  } catch (error) {
    try {
      connection.close()
    } catch {
      // The connection may already be unusable; closing is best-effort.
    }

    if (error instanceof DatabaseInitError) {
      throw error
    }

    throw new DatabaseInitError(
      'open-failed',
      `could not initialise the database at "${filePath}"`,
      { cause: error },
    )
  }
}
