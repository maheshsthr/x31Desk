/**
 * x31Desk — SQLite row reading helpers.
 * ---------------------------------------------------------------------------
 * `node:sqlite` hands a statement's rows back as `unknown`. The adapters know
 * the shape of the tables they query — every column here comes from the
 * migrations in `schema.ts` — so these helpers narrow a row to a readable record
 * and pull a single column out with the expected JavaScript type, without the
 * adapters repeating a cast or a `typeof` at every site.
 *
 * Nothing is invented: a column that is present but of an unexpected type is
 * coerced rather than dropped, because the alternative — returning `undefined`
 * into a record — would break the invariant that a stored record is complete.
 */

/** A row as returned by `node:sqlite`, or an empty record when absent. */
export type SqlRow = Record<string, unknown>

/** Narrows a statement's `.all()` result to an array of rows. */
export function asRows(value: unknown): SqlRow[] {
  return Array.isArray(value) ? (value as SqlRow[]) : []
}

/** Narrows a statement's `.get()` result to one row, or `null` when absent. */
export function asRow(value: unknown): SqlRow | null {
  return typeof value === 'object' && value !== null ? (value as SqlRow) : null
}

/** Reads a `NOT NULL` text column. */
export function readString(row: SqlRow, key: string): string {
  const value = row[key]

  return typeof value === 'string' ? value : String(value)
}

/** Reads a `NOT NULL` integer/real column. */
export function readNumber(row: SqlRow, key: string): number {
  const value = row[key]

  return typeof value === 'number' ? value : Number(value)
}

/** Reads a nullable text column, mapping SQL `NULL` to `null`. */
export function readNullableString(row: SqlRow, key: string): string | null {
  const value = row[key]

  if (value === null || value === undefined) {
    return null
  }

  return typeof value === 'string' ? value : String(value)
}

/** Reads a nullable integer/real column, mapping SQL `NULL` to `null`. */
export function readNullableNumber(row: SqlRow, key: string): number | null {
  const value = row[key]

  if (value === null || value === undefined) {
    return null
  }

  return typeof value === 'number' ? value : Number(value)
}

/** Reads a column stored as `0`/`1` as a boolean. */
export function readBoolean(row: SqlRow, key: string): boolean {
  return readNumber(row, key) !== 0
}

/**
 * Converts a JavaScript value to something SQLite can bind.
 *
 * `node:sqlite` accepts `null`, numbers, bigints, strings and byte arrays. A
 * boolean is converted to the `0`/`1` the schema's `CHECK` constraints expect,
 * and `undefined` becomes `NULL` rather than throwing, so an optional field can
 * be passed straight through.
 */
export function toBinding(value: unknown): null | number | bigint | string | Uint8Array {
  if (value === undefined) {
    return null
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }

  return value as null | number | bigint | string | Uint8Array
}
