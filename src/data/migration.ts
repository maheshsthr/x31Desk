/**
 * x31Desk — the renderer's half of the one-time `localStorage` → SQLite import.
 * ---------------------------------------------------------------------------
 * The main process owns the database, but only the renderer can see
 * `localStorage`, so the import is a conversation: the renderer detects whether
 * it is running in the desktop shell, asks the main process whether the import
 * has already finished, reads and *validates* the workspace out of
 * `localStorage`, and hands an all-or-nothing snapshot to the main process to
 * write.
 *
 * The state machine is deliberately explicit — `not-started`, `in-progress`,
 * `completed`, `failed` — and it never reports `completed` on its own: that
 * state is only reached when the main process says the import (or a previous
 * one) is finished. In a browser the whole thing is `not-started` and does
 * nothing, so web-only development is unchanged.
 *
 * Two rules run through the design:
 *
 *   * **Nothing is silently dropped.** If a collection is present but malformed
 *     — bad JSON, or an entry that fails its own guard — the source is refused
 *     as a whole. Its bytes are preserved (write-once) under the collection's
 *     existing `:unreadable` key first, exactly as the normal readers do, and
 *     the import does not proceed. A snapshot with a hole in it is not complete.
 *   * **Nothing is written to `localStorage`.** The original collection keys and
 *     every existing quarantine key are left exactly as they were; the only
 *     possible write is preserving bytes that could not be read, which is
 *     additive and best effort.
 *
 * This module only performs and reports the import; it never switches the
 * storage backend itself. The binding is decided by `src/data/desktopStorage.ts`,
 * which runs this and rebinds the repositories to SQLite only once the state is
 * `completed`.
 */

import {
  MIGRATION_COLLECTIONS,
  type MigrationCollectionName,
  type MigrationConflict,
  type MigrationOutcome,
  type MigrationRecordCounts,
  type MigrationSource,
  type MigrationStatusResult,
} from '@/data/ipc/contract'
import { preserveUnreadable, QUARANTINE_KEYS, readQuarantinedPayloads } from '@/data/quarantine'
import { classifyStorageError, type StorageErrorKind } from '@/data/storageError'
import { STORAGE_KEYS } from '@/data/storageKeys'
import type { DesktopMigrationBridge } from '@/types/desktop'
import { isArchivedItem } from '@/types/archive'
import { isNote } from '@/types/note'
import { isSnippet } from '@/types/snippet'
import { isTask } from '@/types/task'

/** The state the one-time import is in from the renderer's point of view. */
export type MigrationState = 'not-started' | 'in-progress' | 'completed' | 'failed'

/** Why an import did not complete. */
export type StorageMigrationFailure =
  | { readonly reason: 'invalid-source'; readonly collections: readonly MigrationCollectionName[] }
  | { readonly reason: 'conflict'; readonly conflicts: readonly MigrationConflict[] }
  | { readonly reason: 'verification-failed' }
  | { readonly reason: 'storage'; readonly kind: StorageErrorKind }

/** The result of one attempt to run the import. */
export type StorageMigrationReport = {
  readonly state: MigrationState
  /** Whether an import applies here at all (false in a plain browser). */
  readonly applicable: boolean
  /** Present once the state is `completed`. */
  readonly counts?: MigrationRecordCounts
  /** True when the main process reported the import had already finished. */
  readonly alreadyCompleted?: boolean
  /**
   * The `:unreadable` keys that hold preserved payloads. Reported so the outcome
   * is explicit; never restored, rewritten or removed by the import.
   */
  readonly quarantinedKeys: readonly string[]
  /** Present when the state is `failed`. */
  readonly failure?: StorageMigrationFailure
}

/** Options for {@link runStorageMigration}, all injectable for tests. */
export type StorageMigrationOptions = {
  /** The bridge to use; defaults to `window.x31deskDesktop?.migration`. */
  readonly bridge?: DesktopMigrationBridge
  /** Called as the state advances, so a caller can observe `in-progress`. */
  readonly onStateChange?: (state: MigrationState) => void
  /** The storage to read; defaults to `window.localStorage`. */
  readonly storage?: Storage
}

/** The `localStorage` key each imported collection lives under. */
const COLLECTION_STORAGE_KEYS: Record<MigrationCollectionName, string> = {
  notes: STORAGE_KEYS.notes,
  tasks: STORAGE_KEYS.tasks,
  snippets: STORAGE_KEYS.snippets,
  archive: STORAGE_KEYS.archive,
}

/** Parses and fully validates one collection's raw bytes, or returns `null`. */
function parseCollection<T>(raw: string | null, guard: (value: unknown) => value is T): T[] | null {
  // An absent or empty key is an empty collection, not an error.
  if (raw === null || raw === '') {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!Array.isArray(parsed)) {
    return null
  }

  const records: T[] = []

  for (const entry of parsed) {
    // Any single bad entry fails the whole collection: the import must not drop
    // a record it cannot understand and then call itself complete.
    if (!guard(entry)) {
      return null
    }

    records.push(entry)
  }

  return records
}

/** Reads one collection, preserving its bytes when it cannot be validated. */
function readCollection<T>(
  name: MigrationCollectionName,
  raw: string | null,
  guard: (value: unknown) => value is T,
  invalid: MigrationCollectionName[],
): T[] | null {
  const records = parseCollection(raw, guard)

  if (records === null) {
    preserveUnreadable(QUARANTINE_KEYS[name], raw ?? '')
    invalid.push(name)
  }

  return records
}

/** The result of reading the workspace out of `localStorage`. */
export type MigrationSourceRead =
  | { readonly ok: true; readonly source: MigrationSource }
  | { readonly ok: false; readonly reason: 'invalid'; readonly collections: readonly MigrationCollectionName[] }
  | { readonly ok: false; readonly reason: 'unavailable'; readonly kind: StorageErrorKind }

/**
 * Reads and validates the whole workspace.
 *
 * Unlike the normal collection readers, this refuses the snapshot when any
 * collection is unreadable rather than returning the records it could salvage —
 * the import needs to know it has *everything* before it starts.
 */
export function readMigrationSource(storage: Storage = window.localStorage): MigrationSourceRead {
  const raw: Record<MigrationCollectionName, string | null> = {
    notes: null,
    tasks: null,
    snippets: null,
    archive: null,
  }

  try {
    for (const name of MIGRATION_COLLECTIONS) {
      raw[name] = storage.getItem(COLLECTION_STORAGE_KEYS[name])
    }
  } catch (error) {
    return { ok: false, reason: 'unavailable', kind: classifyStorageError(error) }
  }

  const invalid: MigrationCollectionName[] = []
  const notes = readCollection('notes', raw.notes, isNote, invalid)
  const tasks = readCollection('tasks', raw.tasks, isTask, invalid)
  const snippets = readCollection('snippets', raw.snippets, isSnippet, invalid)
  const archive = readCollection('archive', raw.archive, isArchivedItem, invalid)

  if (notes === null || tasks === null || snippets === null || archive === null) {
    return { ok: false, reason: 'invalid', collections: invalid }
  }

  return { ok: true, source: { notes, tasks, snippets, archive } }
}

/** The bridge, when the renderer is running inside the Electron shell. */
function desktopMigration(): DesktopMigrationBridge | undefined {
  return window.x31deskDesktop?.migration
}

/** The `:unreadable` keys currently holding preserved payloads. */
function quarantinedStorageKeys(): string[] {
  return readQuarantinedPayloads().map((payload) => payload.storageKey)
}

/** Maps a main-process outcome onto a renderer report. */
function reportFor(outcome: MigrationOutcome, quarantinedKeys: readonly string[]): StorageMigrationReport {
  const base = { applicable: true, quarantinedKeys }

  switch (outcome.outcome) {
    case 'completed':
      return {
        ...base,
        state: 'completed',
        counts: outcome.counts,
        alreadyCompleted: outcome.alreadyCompleted,
      }
    case 'invalid-source':
      return {
        ...base,
        state: 'failed',
        failure: { reason: 'invalid-source', collections: outcome.collections },
      }
    case 'conflict':
      return { ...base, state: 'failed', failure: { reason: 'conflict', conflicts: outcome.conflicts } }
    case 'verification-failed':
      return { ...base, state: 'failed', failure: { reason: 'verification-failed' } }
    case 'unavailable':
      return { ...base, state: 'failed', failure: { reason: 'storage', kind: 'unavailable' } }
    case 'failed':
      return { ...base, state: 'failed', failure: { reason: 'storage', kind: outcome.kind } }
  }
}

/**
 * Runs the one-time import end to end and reports the outcome.
 *
 * In a browser it resolves `not-started` without touching anything. In the
 * desktop shell it inspects the recorded state, reads and validates the source
 * and — only when the import has not already finished — asks the main process to
 * perform it. The function never throws: a rejected bridge call is classified
 * into a `storage` failure like any other.
 */
export async function runStorageMigration(
  options: StorageMigrationOptions = {},
): Promise<StorageMigrationReport> {
  const bridge = options.bridge ?? desktopMigration()
  const quarantinedKeys = quarantinedStorageKeys()
  const { onStateChange } = options

  const finish = (report: StorageMigrationReport): StorageMigrationReport => {
    onStateChange?.(report.state)
    return report
  }

  if (bridge === undefined) {
    return { state: 'not-started', applicable: false, quarantinedKeys }
  }

  onStateChange?.('in-progress')

  let status: MigrationStatusResult

  try {
    status = await bridge.status()
  } catch (error) {
    return finish({
      state: 'failed',
      applicable: true,
      quarantinedKeys,
      failure: { reason: 'storage', kind: classifyStorageError(error) },
    })
  }

  if (status.status === 'completed') {
    return finish({
      state: 'completed',
      applicable: true,
      counts: status.counts,
      alreadyCompleted: true,
      quarantinedKeys,
    })
  }

  if (status.status === 'unavailable') {
    return finish({
      state: 'failed',
      applicable: true,
      quarantinedKeys,
      failure: { reason: 'storage', kind: 'unavailable' },
    })
  }

  const read = readMigrationSource(options.storage)

  if (!read.ok) {
    if (read.reason === 'unavailable') {
      return finish({
        state: 'failed',
        applicable: true,
        quarantinedKeys,
        failure: { reason: 'storage', kind: read.kind },
      })
    }

    return finish({
      state: 'failed',
      applicable: true,
      quarantinedKeys,
      failure: { reason: 'invalid-source', collections: read.collections },
    })
  }

  let outcome: MigrationOutcome

  try {
    outcome = await bridge.import({ source: read.source })
  } catch (error) {
    return finish({
      state: 'failed',
      applicable: true,
      quarantinedKeys,
      failure: { reason: 'storage', kind: classifyStorageError(error) },
    })
  }

  return finish(reportFor(outcome, quarantinedKeys))
}
