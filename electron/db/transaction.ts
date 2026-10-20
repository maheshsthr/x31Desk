/**
 * x31Desk — multi-statement SQLite transactions.
 * ---------------------------------------------------------------------------
 * `node:sqlite` runs each statement in its own implicit transaction, which is
 * enough for a single `INSERT`, `UPDATE` or `DELETE`. Operations that must see a
 * consistent snapshot across more than one statement — a read-then-write update,
 * or a snippet row and its tags — open an explicit transaction here instead.
 *
 * `BEGIN IMMEDIATE` takes the write lock up front, so a transaction cannot fail
 * part-way through on lock acquisition, and `synchronous = FULL` means a
 * `COMMIT` has reached the disk before this returns. A step that throws is rolled
 * back in full, so a failed operation never leaves half its writes behind.
 *
 * The main process is synchronous and single-threaded, so these transactions
 * cannot interleave with one another; they group statements for atomicity and
 * durability, not for concurrency.
 */

import type { DatabaseSync } from 'node:sqlite'

/** Runs `operation` inside one transaction, committing or rolling back as a unit. */
export function runInTransaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec('BEGIN IMMEDIATE')

  try {
    const result = operation()

    database.exec('COMMIT')

    return result
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // The transaction had already been rolled back; there is nothing to do.
    }

    throw error
  }
}
