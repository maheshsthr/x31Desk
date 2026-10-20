/**
 * x31Desk — the SQLite archive's corruption vault.
 * ---------------------------------------------------------------------------
 * The `localStorage` archive reader preserves a payload it cannot understand
 * instead of destroying it: it copies the original bytes to a sibling
 * `x31desk:archive:unreadable` key and only then leaves the bad entries out of
 * the list it returns. This module is the SQLite equivalent of that guarantee.
 *
 * An `archive` row the adapter cannot read back — malformed JSON, or valid JSON
 * that is not an {@link ArchivedItem} — is copied — verbatim, before it is left
 * out of `list()` — into the `archive_corruption` table, beside the `type`,
 * `record_id` and `archived_at` it was stored under. It is a *separate* table
 * for one reason: the live archive stays exactly as it was, so a later
 * legitimate write for the same key can never overwrite the preserved bytes,
 * and the malformed row is never moved, edited or deleted to make room.
 *
 * Preservation is write-once and best effort, exactly as `preserveUnreadable`
 * is: the first payload seen for a key is the one kept, and a storage failure
 * is swallowed so the archive can still open. Nothing here ever restores,
 * overwrites, imports or deletes a payload — the only thing that removes a
 * preserved entry is the user's explicit "clear" of the archive, which is the
 * same moment the `localStorage` adapter drops its quarantined bytes.
 *
 * The payload is never parsed or normalised: a value that could not be
 * understood is the wrong thing to run through a normaliser. A recovery surface
 * can read the entries back verbatim through {@link ArchiveQuarantine.list}.
 */

import type { DatabaseSync } from 'node:sqlite'

import {
  asRow,
  asRows,
  readNullableNumber,
  readNumber,
  readString,
  toBinding,
  type SqlRow,
} from './rows.ts'

/**
 * One archive row the adapter could not read back, preserved as it was.
 *
 * `data` is the original column exactly as stored. `type`, `recordId` and
 * `archivedAt` are the identity columns, kept so the affected record can be
 * named without parsing the payload.
 */
export type CorruptArchiveEntry = {
  /** The malformed row's `type` column. */
  readonly type: string
  /** The malformed row's `record_id` column. */
  readonly recordId: string
  /** The malformed row's `archived_at` column, which may be absent. */
  readonly archivedAt: number | null
  /** The original `data` column, verbatim. Never parsed or normalised. */
  readonly data: string
  /** When the row was first preserved, epoch milliseconds. */
  readonly detectedAt: number
}

/**
 * Reads a raw `archive` row the adapter could not interpret into a
 * {@link CorruptArchiveEntry}. `detectedAt` is supplied by the caller so a
 * batch of rows shares one timestamp.
 */
export function readCorruptArchiveEntry(row: SqlRow, detectedAt: number): CorruptArchiveEntry {
  return {
    type: readString(row, 'type'),
    recordId: readString(row, 'record_id'),
    archivedAt: readNullableNumber(row, 'archived_at'),
    data: readString(row, 'data'),
    detectedAt,
  }
}

/** The corruption vault for one open database connection. */
export type ArchiveQuarantine = {
  /** Preserves one entry, write-once. Best effort: never throws. */
  preserve: (entry: CorruptArchiveEntry) => void
  /** Every preserved entry, oldest first. */
  list: () => CorruptArchiveEntry[]
  /** Whether anything has been preserved. */
  has: () => boolean
  /** Discards every preserved entry, for the user's explicit archive reset. */
  clear: () => void
}

/** Converts one vault row back to a {@link CorruptArchiveEntry}. */
function rowToEntry(row: SqlRow): CorruptArchiveEntry {
  return {
    type: readString(row, 'type'),
    recordId: readString(row, 'record_id'),
    archivedAt: readNullableNumber(row, 'archived_at'),
    data: readString(row, 'data'),
    detectedAt: readNumber(row, 'detected_at'),
  }
}

/**
 * The corruption vault.
 *
 * Statements are prepared once against the connection. `INSERT OR IGNORE` is
 * what makes preservation write-once: a key that already has a preserved
 * payload is left untouched, so a second, different corruption of the same
 * record can never replace the first.
 */
export function createArchiveQuarantine(database: DatabaseSync): ArchiveQuarantine {
  const insertIfAbsent = database.prepare(`
    INSERT OR IGNORE INTO archive_corruption
      (type, record_id, archived_at, data, detected_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  const selectAll = database.prepare(
    'SELECT type, record_id, archived_at, data, detected_at FROM archive_corruption ORDER BY rowid',
  )
  const countAll = database.prepare('SELECT COUNT(*) AS count FROM archive_corruption')
  const deleteAll = database.prepare('DELETE FROM archive_corruption')

  return {
    preserve(entry) {
      try {
        insertIfAbsent.run(
          entry.type,
          entry.recordId,
          toBinding(entry.archivedAt),
          entry.data,
          entry.detectedAt,
        )
      } catch {
        // Preserving is best effort. The archive must still open even if the
        // payload cannot be written down, exactly as preserveUnreadable behaves.
      }
    },

    list() {
      return asRows(selectAll.all()).map(rowToEntry)
    },

    has() {
      const row = asRow(countAll.get())

      return row !== null && readNumber(row, 'count') > 0
    },

    clear() {
      deleteAll.run()
    },
  }
}
