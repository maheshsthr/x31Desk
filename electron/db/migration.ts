/**
 * x31Desk — the one-time `localStorage` → SQLite import.
 * ---------------------------------------------------------------------------
 * This module is the main process's half of the migration: it owns the
 * completion marker in the `meta` table and performs the actual write. It is
 * deliberately *not* wired to any repository — it only populates the tables the
 * repositories read. Whether those repositories are authoritative is decided in
 * the renderer; this module just makes sure the data is there first.
 *
 * The whole import runs in **one transaction** and only marks itself complete
 * after it has verified what it wrote:
 *
 *   1. read the completion marker — if it is present, do nothing (idempotent);
 *   2. fold the source records into keyed maps, refusing a source that names
 *      one key twice with different content;
 *   3. inside a transaction, compare every record against the destination,
 *      accepting an exact match and refusing a mismatch (never overwriting);
 *   4. insert only the records the destination does not already hold;
 *   5. re-read the destination and compare *full content*, not counts;
 *   6. write the completion marker — still inside the transaction — and commit.
 *
 * A conflict, a verification failure or any other exception rolls the
 * transaction back in full, so the marker is never set on a partial import and a
 * failed attempt leaves the database exactly as it was. The `localStorage`
 * source is only ever read by the renderer; nothing here can modify it.
 *
 * Every read and write of a *whole collection* comes from `workspaceIO.ts`,
 * which the backup importer shares. Keeping them in one place is what guarantees
 * a record round-trips through the database in the same shape whichever feature
 * put it there; the policy that stays here is this import's own — the marker,
 * and "refuse rather than overwrite".
 */

import type { DatabaseSync } from 'node:sqlite'

import type {
  MigrationCollectionName,
  MigrationConflict,
  MigrationOutcome,
  MigrationRecordCounts,
  MigrationSource,
  MigrationStatusResult,
} from '@/data/ipc/contract'

import { asRow, readString } from './rows.ts'
import { runInTransaction } from './transaction.ts'
import {
  destinationMatches,
  foldWorkspace,
  readDestination,
  writeArchive,
  writeNotes,
  writeSnippets,
  writeTasks,
} from './workspaceIO.ts'

/**
 * The `meta` key that records the import.
 *
 * It is a row of its own, distinct from `PRAGMA user_version` (which describes
 * the SQLite schema) and from the renderer's `x31desk:schema` marker (which
 * describes the `localStorage` records). The three move independently and none
 * rewrites another.
 */
export const MIGRATION_MARKER_KEY = 'migration:localStorage-import'

/** The shape version of the marker value this build writes. */
export const MIGRATION_MARKER_VERSION = 1

/** The contents of the completion marker. */
export type MigrationMarker = {
  readonly version: number
  readonly completedAt: number
  readonly counts: MigrationRecordCounts
}

/** Thrown inside the transaction when a source record disagrees with the destination. */
class MigrationConflictError extends Error {
  readonly conflicts: readonly MigrationConflict[]

  constructor(conflicts: readonly MigrationConflict[]) {
    super('migration conflict')
    this.name = 'MigrationConflictError'
    this.conflicts = conflicts
  }
}

/** Thrown inside the transaction when a re-read does not match what was written. */
class MigrationVerificationError extends Error {
  constructor() {
    super('migration verification failed')
    this.name = 'MigrationVerificationError'
  }
}

/** One source record with its canonical form already computed. */
type SourceEntry<T> = { readonly record: T; readonly canonical: string }

/** Validates a stored marker value, returning `null` for anything unrecognised. */
function parseMarker(raw: string): MigrationMarker | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const candidate = parsed as Record<string, unknown>

  if (candidate.version !== MIGRATION_MARKER_VERSION) {
    return null
  }

  if (typeof candidate.completedAt !== 'number' || !Number.isFinite(candidate.completedAt)) {
    return null
  }

  const counts = candidate.counts

  if (typeof counts !== 'object' || counts === null) {
    return null
  }

  const recordCounts = counts as Record<string, unknown>

  if (!isCount(recordCounts.notes) || !isCount(recordCounts.tasks) || !isCount(recordCounts.snippets) || !isCount(recordCounts.archive)) {
    return null
  }

  return {
    version: MIGRATION_MARKER_VERSION,
    completedAt: candidate.completedAt,
    counts: {
      notes: recordCounts.notes,
      tasks: recordCounts.tasks,
      snippets: recordCounts.snippets,
      archive: recordCounts.archive,
    },
  }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Reads the completion marker.
 *
 * An absent *or unreadable* marker yields `null`: a marker whose value cannot be
 * trusted means the import must be reconsidered, not assumed finished. If the
 * rows are in fact already present, the retry finds them identical and completes
 * without writing anything; if they conflict, it refuses rather than overwrite.
 */
export function readMigrationMarker(database: DatabaseSync): MigrationMarker | null {
  const row = asRow(database.prepare('SELECT value FROM meta WHERE key = ?').get(MIGRATION_MARKER_KEY))

  if (row === null) {
    return null
  }

  return parseMarker(readString(row, 'value'))
}

/** Writes the completion marker. Called only inside the import transaction. */
export function writeMigrationMarker(database: DatabaseSync, marker: MigrationMarker): void {
  database
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(MIGRATION_MARKER_KEY, JSON.stringify(marker))
}

/** Reads the marker into the shape the renderer's status call reports. */
export function readMigrationStatus(database: DatabaseSync): MigrationStatusResult {
  const marker = readMigrationMarker(database)

  if (marker === null) {
    return { status: 'not-started' }
  }

  return { status: 'completed', completedAt: marker.completedAt, counts: marker.counts }
}

/**
 * Compares a collection both ways: every source record must either be absent
 * from the destination or an exact match, and the destination must hold nothing
 * the source does not.
 */
function collectConflicts(
  collection: MigrationCollectionName,
  source: Map<string, SourceEntry<unknown>>,
  destination: Map<string, string>,
  conflicts: MigrationConflict[],
): void {
  for (const [key, entry] of source) {
    const existing = destination.get(key)

    if (existing !== undefined && existing !== entry.canonical) {
      conflicts.push({ collection, id: key })
    }
  }

  for (const key of destination.keys()) {
    if (!source.has(key)) {
      conflicts.push({ collection, id: key })
    }
  }
}

/**
 * Imports a `localStorage` snapshot into the database.
 *
 * Returns a typed outcome; the only failure it throws is an unexpected database
 * error, which the IPC handler reduces to a `StorageErrorKind`. An already
 * completed import is a no-op, so a retry after success writes nothing.
 */
export function importWorkspace(database: DatabaseSync, source: MigrationSource): MigrationOutcome {
  const marker = readMigrationMarker(database)

  if (marker !== null) {
    return { outcome: 'completed', counts: marker.counts, alreadyCompleted: true }
  }

  const sourceConflicts: MigrationConflict[] = []
  const maps = foldWorkspace(source, (collection, id) => sourceConflicts.push({ collection, id }))

  if (sourceConflicts.length > 0) {
    return { outcome: 'conflict', conflicts: sourceConflicts }
  }

  try {
    const counts = runInTransaction(database, () => {
      const destination = readDestination(database)
      const conflicts: MigrationConflict[] = []

      collectConflicts('notes', maps.notes, destination.notes, conflicts)
      collectConflicts('tasks', maps.tasks, destination.tasks, conflicts)
      collectConflicts('snippets', maps.snippets, destination.snippets, conflicts)
      collectConflicts('archive', maps.archive, destination.archive, conflicts)

      if (conflicts.length > 0) {
        throw new MigrationConflictError(conflicts)
      }

      writeNotes(database, maps.notes, destination.notes)
      writeTasks(database, maps.tasks, destination.tasks)
      writeSnippets(database, maps.snippets, destination.snippets)
      writeArchive(database, maps.archive, destination.archive)

      if (!destinationMatches(maps, readDestination(database))) {
        throw new MigrationVerificationError()
      }

      const written: MigrationRecordCounts = {
        notes: maps.notes.size,
        tasks: maps.tasks.size,
        snippets: maps.snippets.size,
        archive: maps.archive.size,
      }

      writeMigrationMarker(database, {
        version: MIGRATION_MARKER_VERSION,
        completedAt: Date.now(),
        counts: written,
      })

      return written
    })

    return { outcome: 'completed', counts, alreadyCompleted: false }
  } catch (error) {
    if (error instanceof MigrationConflictError) {
      return { outcome: 'conflict', conflicts: error.conflicts }
    }

    if (error instanceof MigrationVerificationError) {
      return { outcome: 'verification-failed' }
    }

    throw error
  }
}
