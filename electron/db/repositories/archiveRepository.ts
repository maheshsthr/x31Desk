/**
 * x31Desk — the SQLite-backed archive repository.
 * ---------------------------------------------------------------------------
 * Implements the same `ArchiveRepository` interface the `localStorage` adapter
 * does. An entry is keyed by `(type, record_id)` — the same pair `archiveKey`
 * builds — so `add` upserts and a record can never appear in the archive twice,
 * exactly as the `localStorage` adapter guarantees.
 *
 * The whole {@link ArchivedItem} is stored as JSON in the `data` column, beside
 * the `type`, `record_id` and `archived_at` columns that are pulled out for
 * keying and ordering. Keeping the record verbatim is what lets a restore put an
 * item back exactly as it was rather than as an approximation of it.
 *
 * A row that cannot be read back is *preserved*, not quietly dropped: its bytes
 * and identity go to the corruption vault (`archiveQuarantine.ts`) before it is
 * left out of `list()`, which is the SQLite counterpart of the `localStorage`
 * adapter quarantining an unreadable collection. The row itself is never moved,
 * edited or deleted.
 */

import type { DatabaseSync } from 'node:sqlite'

import type { ArchiveRepository } from '@/data/repositoryTypes'
import { archivedRecordId, isArchivedItem, type ArchivedItem } from '@/types/archive'

import { createArchiveQuarantine, readCorruptArchiveEntry } from '../archiveQuarantine.ts'
import { asRows, readString } from '../rows.ts'
import { runInTransaction } from '../transaction.ts'

/**
 * Newest first: the archive is presented most-recently-set-aside at the top,
 * matching the `localStorage` adapter's prepend. `rowid` breaks a tie between
 * entries archived in the same millisecond so the order is still stable.
 *
 * The identity columns are selected alongside `data` so a row that fails to
 * parse can still be named when it is preserved.
 */
const SELECT_ALL =
  'SELECT type, record_id, archived_at, data FROM archive ORDER BY archived_at DESC, rowid DESC'

/**
 * Converts one `archive` row's `data` column back to an {@link ArchivedItem}.
 *
 * Exported so the one-time `localStorage` import reads a row through the same
 * mapping the repository uses, rather than a second copy that could drift.
 */
export function toArchivedItem(row: Record<string, unknown>): ArchivedItem | null {
  const raw = readString(row, 'data')

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  return isArchivedItem(parsed) ? parsed : null
}

/**
 * The SQLite-backed archive store.
 *
 * A row the adapter cannot read back is preserved in the corruption vault and
 * left out of the returned list rather than thrown: the archive must still open.
 * The adapter wrote every row itself, so this only fires if a file was edited
 * outside the application. Skipping it is never silent — the bytes and the
 * record's identity are kept for recovery first.
 */
export function createSqliteArchiveRepository(database: DatabaseSync): ArchiveRepository {
  const selectAll = database.prepare(SELECT_ALL)
  const upsert = database.prepare(`
    INSERT INTO archive (type, record_id, archived_at, data)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(type, record_id) DO UPDATE SET
      archived_at = excluded.archived_at,
      data = excluded.data
  `)
  const deleteOne = database.prepare('DELETE FROM archive WHERE type = ? AND record_id = ?')
  const deleteAll = database.prepare('DELETE FROM archive')
  const quarantine = createArchiveQuarantine(database)

  return {
    async list() {
      const items: ArchivedItem[] = []
      const detectedAt = Date.now()

      for (const row of asRows(selectAll.all())) {
        const item = toArchivedItem(row)

        if (item !== null) {
          items.push(item)
          continue
        }

        // Preserve before skipping, so an unreadable row is never lost. The
        // vault is write-once and swallows its own failures.
        quarantine.preserve(readCorruptArchiveEntry(row, detectedAt))
      }

      return items
    },

    async add(entry) {
      upsert.run(entry.type, archivedRecordId(entry), entry.archivedAt, JSON.stringify(entry))

      return entry
    },

    async remove(type, id) {
      deleteOne.run(type, id)
    },

    async clear() {
      // A reset is the one moment the user has asked for archived data to be
      // gone for good, so — exactly as the `localStorage` adapter clears its
      // quarantined bytes — the corruption vault goes with it. This is the only
      // operation that removes a preserved payload.
      runInTransaction(database, () => {
        deleteAll.run()
        quarantine.clear()
      })
    },
  }
}
