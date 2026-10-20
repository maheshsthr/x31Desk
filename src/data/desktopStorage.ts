/**
 * x31Desk — choosing the workspace store at startup.
 * ---------------------------------------------------------------------------
 * The application is written against the four repository interfaces, and each
 * has two implementations that share it: the `localStorage` one (the web build,
 * and the desktop shell before this module has run) and the SQLite one, reached
 * over the preload bridge (the desktop shell).
 *
 * Which one is *authoritative* is decided here, exactly once, before the
 * workspace is first read:
 *
 *   * **A plain browser** has no bridge, so nothing changes: the
 *     `localStorage` stores stay bound and web-only development is untouched.
 *   * **The desktop shell** runs the one-time import and, only once it has
 *     *completed*, rebinds all four stores to SQLite.
 *
 * The rule that shapes the failure handling is that there is no silent fallback.
 * If the database cannot be opened, or the import cannot complete, the stores
 * are left exactly where they are and this module reports a failure — the
 * startup gate shows that failure instead of mounting the application. After the
 * import has completed, `localStorage` is no longer authoritative, so showing it
 * would present stale records as if they were the user's workspace.
 *
 * Nothing here writes `localStorage`: the import module owns that, and it only
 * ever preserves bytes it could not read.
 */

import {
  bindArchiveRepository,
  resetArchiveRepository,
} from '@/data/archiveRepository'
import { createIpcArchiveRepository } from '@/data/ipc/archiveRepository'
import { createIpcNoteRepository } from '@/data/ipc/noteRepository'
import { createIpcSnippetRepository } from '@/data/ipc/snippetRepository'
import { createIpcTaskRepository } from '@/data/ipc/taskRepository'
import type { MigrationCollectionName, MigrationConflict } from '@/data/ipc/contract'
import {
  runStorageMigration,
  type StorageMigrationFailure,
  type StorageMigrationOptions,
  type StorageMigrationReport,
} from '@/data/migration'
import { bindNoteRepository, resetNoteRepository } from '@/data/noteRepository'
import { bindSnippetRepository, resetSnippetRepository } from '@/data/snippetRepository'
import type { StorageErrorKind } from '@/data/storageError'
import { bindTaskRepository, resetTaskRepository } from '@/data/taskRepository'
import type { DesktopBridge } from '@/types/desktop'

/** Which store the application ended up bound to. */
export type WorkspaceBackend = 'local' | 'sqlite'

/**
 * Why the desktop workspace could not be brought up.
 *
 * `database-unavailable` covers both "the file could not be opened" and "the
 * shell could not be reached"; the import reasons are the decisions the import
 * module reports. All of them mean the same thing to the user — the workspace
 * could not be read, and nothing was changed — but naming them lets the error
 * screen explain the actual cause.
 */
export type WorkspaceStorageFailure =
  | { readonly reason: 'database-unavailable' }
  | { readonly reason: 'import-invalid'; readonly collections: readonly MigrationCollectionName[] }
  | { readonly reason: 'import-conflict'; readonly conflicts: readonly MigrationConflict[] }
  | { readonly reason: 'import-verification' }
  | { readonly reason: 'storage'; readonly kind: StorageErrorKind }

/** The outcome of choosing a workspace store. */
export type WorkspaceStorageReport =
  | {
      readonly ok: true
      readonly backend: WorkspaceBackend
      /** Present in the desktop shell; absent in a plain browser. */
      readonly migration?: StorageMigrationReport
    }
  | { readonly ok: false; readonly failure: WorkspaceStorageFailure }

/** Options for {@link initializeWorkspaceStorage}, all injectable for tests. */
export type InitializeWorkspaceStorageOptions = {
  /** The bridge to use; defaults to `window.x31deskDesktop`. */
  readonly bridge?: DesktopBridge
  /** The `localStorage` the import reads; defaults to `window.localStorage`. */
  readonly storage?: Storage
  /** The migration runner; defaults to {@link runStorageMigration}. */
  readonly runMigration?: (options: StorageMigrationOptions) => Promise<StorageMigrationReport>
}

/** The desktop bridge, when the renderer is running inside Electron. */
function desktopBridge(): DesktopBridge | undefined {
  return window.x31deskDesktop
}

/** Maps a migration failure onto the startup failure vocabulary. */
export function mapMigrationFailure(failure: StorageMigrationFailure): WorkspaceStorageFailure {
  switch (failure.reason) {
    case 'invalid-source':
      return { reason: 'import-invalid', collections: failure.collections }
    case 'conflict':
      return { reason: 'import-conflict', conflicts: failure.conflicts }
    case 'verification-failed':
      return { reason: 'import-verification' }
    case 'storage':
      return failure.kind === 'unavailable'
        ? { reason: 'database-unavailable' }
        : { reason: 'storage', kind: failure.kind }
  }
}

/**
 * Binds all four stores to the SQLite repositories in the main process.
 *
 * Exported so the binding can be exercised directly; {@link
 * initializeWorkspaceStorage} is what calls it in production.
 */
export function bindDesktopRepositories(bridge: DesktopBridge): void {
  bindNoteRepository(createIpcNoteRepository(bridge.notes))
  bindTaskRepository(createIpcTaskRepository(bridge.tasks))
  bindSnippetRepository(createIpcSnippetRepository(bridge.snippets))
  bindArchiveRepository(createIpcArchiveRepository(bridge.archive))
}

/** Returns all four stores to their in-browser implementations. Used by tests. */
export function resetWorkspaceRepositories(): void {
  resetNoteRepository()
  resetTaskRepository()
  resetSnippetRepository()
  resetArchiveRepository()
}

/**
 * Decides which store is authoritative and binds it.
 *
 * Never throws: an unexpected failure while reading the bridge or binding the
 * adapters is reported as a storage failure, so the startup gate always has a
 * reason to show rather than a rejected promise to swallow.
 */
export async function initializeWorkspaceStorage(
  options: InitializeWorkspaceStorageOptions = {},
): Promise<WorkspaceStorageReport> {
  const bridge = options.bridge ?? desktopBridge()

  // No shell: this is the web build, and `localStorage` is already bound.
  if (bridge === undefined) {
    return { ok: true, backend: 'local' }
  }

  const migrationRunner = options.runMigration ?? runStorageMigration
  let migration: StorageMigrationReport

  try {
    migration = await migrationRunner({ bridge: bridge.migration, storage: options.storage })
  } catch {
    // `runStorageMigration` does not reject, but an injected runner or a broken
    // bridge might; either way the workspace is not safe to open.
    return { ok: false, failure: { reason: 'database-unavailable' } }
  }

  if (migration.state !== 'completed') {
    const failure = migration.failure ?? { reason: 'storage', kind: 'unknown' }

    return { ok: false, failure: mapMigrationFailure(failure) }
  }

  try {
    bindDesktopRepositories(bridge)
  } catch {
    return { ok: false, failure: { reason: 'storage', kind: 'unknown' } }
  }

  return { ok: true, backend: 'sqlite', migration }
}
