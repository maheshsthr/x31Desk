/**
 * A single note.
 *
 * Timestamps are epoch milliseconds: they sort numerically, survive a JSON
 * round-trip unchanged and can be handed straight to `Intl.DateTimeFormat`.
 * `updatedAt` is what the notes list is ordered by.
 */
export type Note = {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

/** The part of a note the user edits; the store owns ids and timestamps. */
export type NoteDraft = {
  title: string
  content: string
}

/**
 * Validates one entry read from storage. Anything that does not match is
 * discarded rather than trusted, so a hand-edited or truncated payload can
 * never reach the editor as a half-formed note.
 */
export function isNote(value: unknown): value is Note {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate: Record<string, unknown> = value as Record<string, unknown>

  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.title === 'string' &&
    typeof candidate.content === 'string' &&
    typeof candidate.createdAt === 'number' &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.updatedAt === 'number' &&
    Number.isFinite(candidate.updatedAt)
  )
}
