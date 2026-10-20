/** Longest a title is quoted at before it is shortened with an ellipsis. */
export const QUOTED_TITLE_LIMIT = 60

/**
 * Shortens text that is quoted back to the user — a delete confirmation, for
 * instance — so a very long value cannot turn a prompt into a wall of text.
 * Returns the trimmed input unchanged when it already fits.
 */
export function truncate(text: string, maxLength: number = QUOTED_TITLE_LIMIT): string {
  const trimmed = text.trim()

  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength).trimEnd()}…` : trimmed
}
