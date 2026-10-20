/**
 * Storage failure classification.
 * ---------------------------------------------------------------------------
 * Every write and clear the repositories perform goes through here, so a
 * failure can be told apart from an ordinary "nothing to do" result and
 * explained to the user instead of collapsing into one generic message.
 *
 * Only signals a browser exposes reliably are trusted: the `name` and numeric
 * `code` a `DOMException` carries. A private-mode or disabled-storage failure
 * surfaces as a `SecurityError`; a full bucket surfaces as a
 * `QuotaExceededError` (or the legacy Firefox spelling, code 1014). Anything
 * else is deliberately left `unknown`, because guessing would risk telling the
 * user the wrong thing about why their data did not save.
 *
 * This module never decides what to do about a failure — it classifies, tags
 * and remembers. Callers that catch a thrown error classify it directly;
 * callers that only receive a boolean read the remembered kind.
 */

/** Why a storage operation failed, as far as the browser will say. */
export type StorageErrorKind = 'quota' | 'unavailable' | 'unknown'

/** `DOMException` names that mean the storage bucket is full. */
const QUOTA_NAMES: ReadonlySet<string> = new Set([
  'QuotaExceededError',
  // Legacy Firefox spelling, still thrown by older engines.
  'NS_ERROR_DOM_QUOTA_REACHED',
])

/** Legacy numeric codes for the same conditions, for engines without a name. */
const QUOTA_CODES: ReadonlySet<number> = new Set([22, 1014])

/** `DOMException` names that mean storage is blocked or switched off. */
const UNAVAILABLE_NAMES: ReadonlySet<string> = new Set(['SecurityError'])

const UNAVAILABLE_CODES: ReadonlySet<number> = new Set([18])

/** An error tagged with the storage condition it represents. */
export class StorageError extends Error {
  readonly kind: StorageErrorKind

  constructor(kind: StorageErrorKind, options?: { cause?: unknown }) {
    super('Storage operation failed', options)
    this.name = 'StorageError'
    this.kind = kind
  }
}

/** Reads a `name` off an error-shaped value, or `''` when there is none. */
function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name: unknown = (error as { name?: unknown }).name

    if (typeof name === 'string') {
      return name
    }
  }

  return ''
}

/** Reads a numeric `code` off an error-shaped value, or `null` when absent. */
function errorCode(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = (error as { code?: unknown }).code

    if (typeof code === 'number') {
      return code
    }
  }

  return null
}

/**
 * Classifies a failure. An already-tagged error keeps its kind; otherwise the
 * browser's `name` and `code` are inspected, falling back to `unknown`.
 */
export function classifyStorageError(error: unknown): StorageErrorKind {
  if (error instanceof StorageError) {
    return error.kind
  }

  const name = errorName(error)
  const code = errorCode(error)

  if (QUOTA_NAMES.has(name) || (code !== null && QUOTA_CODES.has(code))) {
    return 'quota'
  }

  if (UNAVAILABLE_NAMES.has(name) || (code !== null && UNAVAILABLE_CODES.has(code))) {
    return 'unavailable'
  }

  return 'unknown'
}

/** Wraps a raw failure in a {@link StorageError}, preserving the original. */
export function asStorageError(error: unknown): StorageError {
  return error instanceof StorageError
    ? error
    : new StorageError(classifyStorageError(error), { cause: error })
}

// The most recent storage failure, so a caller that only learns "it failed"
// (a boolean-returning store) can still say why. Recorded at the repository
// boundary — the one place `localStorage` is touched — so it reflects every
// collection without each caller having to thread an error through.
let lastErrorKind: StorageErrorKind | null = null

/** The kind of the most recent storage failure, or `null` after a success. */
export function getLastStorageErrorKind(): StorageErrorKind | null {
  return lastErrorKind
}

/** Forgets the remembered failure, so the next boolean read starts clean. */
export function resetLastStorageErrorKind(): void {
  lastErrorKind = null
}

/**
 * Runs one synchronous storage operation that may throw.
 *
 * Success forgets any earlier failure. A failure is classified, remembered and
 * rethrown as a {@link StorageError}, so a caller that catches directly gets a
 * tagged error while a caller that only sees the boolean still finds the kind.
 */
export function runStorageOperation<T>(operation: () => T): T {
  try {
    const result = operation()
    lastErrorKind = null
    return result
  } catch (error) {
    lastErrorKind = classifyStorageError(error)
    throw asStorageError(error)
  }
}

/**
 * Runs one synchronous storage read that must never throw.
 *
 * A reader always returns a usable value, so a failure is remembered rather
 * than propagated and `fallback` is returned instead.
 */
export function runStorageRead<T>(operation: () => T, fallback: T): T {
  try {
    const result = operation()
    lastErrorKind = null
    return result
  } catch (error) {
    lastErrorKind = classifyStorageError(error)
    return fallback
  }
}

/**
 * A concise, actionable sentence for the given failure, or `fallback` when the
 * cause could not be classified confidently.
 */
export function storageErrorMessage(
  kind: StorageErrorKind | null,
  fallback: string,
): string {
  switch (kind) {
    case 'quota':
      return 'Storage is full, so nothing could be saved or deleted. Free up space and try again.'
    case 'unavailable':
      return 'Storage is unavailable in this browser, so nothing could be saved or deleted.'
    default:
      return fallback
  }
}

/**
 * A short reason to sit beside a "Not saved" indicator, or `null` when there is
 * nothing confident to add. Kept terse because the indicator is deliberately
 * small; {@link storageErrorMessage} is the fuller form for a notification.
 */
export function storageErrorSummary(kind: StorageErrorKind | null): string | null {
  switch (kind) {
    case 'quota':
      return 'storage full'
    case 'unavailable':
      return 'storage unavailable'
    default:
      return null
  }
}
