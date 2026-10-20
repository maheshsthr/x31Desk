/**
 * x31Desk — mapping a SQLite failure to the renderer's storage-error vocabulary.
 * ---------------------------------------------------------------------------
 * A repository operation can fail for a small number of reasons the renderer
 * already knows how to explain. SQLite reports them as a numeric result code:
 * `node:sqlite` puts the *extended* code on the thrown error's `errcode`
 * property, whose low byte is the primary code (`SQLITE_FULL`, `SQLITE_READONLY`,
 * …). Only a condition the user can act on is mapped; everything else is left
 * `unknown`, exactly as `classifyStorageError` treats a signal it cannot
 * confidently read.
 *
 * The raw message, SQL and file path never leave the main process — the renderer
 * receives only the {@link StorageErrorKind} its existing handling understands.
 */

import type { StorageErrorKind } from '@/data/storageError'

// Primary SQLite result codes (the low byte of the extended `errcode`).
const SQLITE_PERM = 3
const SQLITE_READONLY = 8
const SQLITE_IOERR = 10
const SQLITE_FULL = 13
const SQLITE_CANTOPEN = 14
const SQLITE_AUTH = 23

/** Codes that mean the database cannot be written or reached right now. */
const UNAVAILABLE_CODES: ReadonlySet<number> = new Set([
  SQLITE_PERM,
  SQLITE_READONLY,
  SQLITE_IOERR,
  SQLITE_CANTOPEN,
  SQLITE_AUTH,
])

/** Reads a SQLite primary result code off an error-shaped value, or `null`. */
function primaryResultCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }

  const candidate: { errcode?: unknown } = error

  if (typeof candidate.errcode === 'number' && Number.isFinite(candidate.errcode)) {
    // The extended code packs the primary code into its low byte.
    return candidate.errcode & 0xff
  }

  return null
}

/**
 * Classifies a database failure. A full database is `quota`; a read-only,
 * unreachable or unauthorised one is `unavailable`; anything else — including an
 * error that did not come from SQLite — is `unknown`.
 */
export function classifyDatabaseError(error: unknown): StorageErrorKind {
  const code = primaryResultCode(error)

  if (code === SQLITE_FULL) {
    return 'quota'
  }

  if (code !== null && UNAVAILABLE_CODES.has(code)) {
    return 'unavailable'
  }

  return 'unknown'
}
