/**
 * A single saved code snippet.
 *
 * Timestamps are epoch milliseconds, exactly like notes and tasks, so they sort
 * numerically and survive a JSON round-trip unchanged.
 *
 * `language` is a closed union rather than a free string, so a value read from
 * storage can be validated instead of trusted and every language can be given a
 * label in one place (`LANGUAGE_LABELS` in `@/utils/snippet`).
 */
const SNIPPET_LANGUAGE_VALUES = [
  'javascript',
  'typescript',
  'html',
  'css',
  'python',
  'java',
  'php',
  'sql',
  'json',
  'bash',
  'plaintext',
] as const

/** The languages a snippet can be filed under. */
export type SnippetLanguage = (typeof SNIPPET_LANGUAGE_VALUES)[number]

/** The language a snippet starts in before the user chooses another. */
export const DEFAULT_SNIPPET_LANGUAGE: SnippetLanguage = 'plaintext'

const SNIPPET_LANGUAGE_SET: ReadonlySet<string> = new Set<string>(SNIPPET_LANGUAGE_VALUES)

/** Narrows an untrusted value to a language we know how to label. */
export function isSnippetLanguage(value: unknown): value is SnippetLanguage {
  return typeof value === 'string' && SNIPPET_LANGUAGE_SET.has(value)
}

/**
 * A single stored snippet.
 *
 * `tags` is kept as an array: the comma-separated text the editor shows is only
 * a way of typing them, while the array is what search and filtering match on.
 */
export type Snippet = {
  id: string
  title: string
  /** The code verbatim — indentation, blank lines and trailing spaces intact. */
  code: string
  language: SnippetLanguage
  tags: string[]
  createdAt: number
  updatedAt: number
}

/**
 * The part of a snippet the editor holds.
 *
 * `tags` is the raw text of the tag field rather than the parsed array, so a
 * tag that is still being typed (`"react, "`) is not destroyed on the way to
 * the input; the repository parses it into stored tags.
 */
export type SnippetDraft = {
  title: string
  code: string
  language: SnippetLanguage
  /** Comma-separated tag text, e.g. `"react, hooks"`. */
  tags: string
}

/** What a freshly opened, not-yet-saved snippet starts from. */
export const EMPTY_SNIPPET_DRAFT: SnippetDraft = {
  title: '',
  code: '',
  language: DEFAULT_SNIPPET_LANGUAGE,
  tags: '',
}

/**
 * Validates one entry read from storage. A snippet is only ever written with a
 * title and code, so anything missing either is treated as unreadable and
 * dropped rather than trusted, exactly as notes and tasks are handled.
 *
 * Timestamps must be finite, not merely numeric, so `NaN` or an overflowing
 * value such as `1e999` (which parses to `Infinity`) cannot reach the list and
 * break its ordering. Notes, tasks and archived records are validated the same
 * way.
 */
export function isSnippet(value: unknown): value is Snippet {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate: Record<string, unknown> = value as Record<string, unknown>

  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.title === 'string' &&
    candidate.title.length > 0 &&
    typeof candidate.code === 'string' &&
    candidate.code.length > 0 &&
    isSnippetLanguage(candidate.language) &&
    Array.isArray(candidate.tags) &&
    candidate.tags.every((tag) => typeof tag === 'string' && tag.length > 0) &&
    typeof candidate.createdAt === 'number' &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.updatedAt === 'number' &&
    Number.isFinite(candidate.updatedAt)
  )
}

/**
 * Whether a draft holds the two values a snippet cannot be saved without.
 *
 * The workspace writes nothing until this is true, which is what makes a title
 * and code genuinely required rather than merely encouraged.
 */
export function isSnippetDraftComplete(draft: SnippetDraft): boolean {
  return draft.title.trim() !== '' && draft.code.trim() !== ''
}
