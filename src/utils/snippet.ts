import type { Snippet, SnippetLanguage } from '@/types/snippet'

/**
 * Display name of every language, in the order the selector lists them.
 *
 * Typed as an exhaustive record of {@link SnippetLanguage} on purpose: adding a
 * language without giving it a label is a compile error, and an unknown key is
 * one too, so the union and the labels cannot drift apart.
 */
export const LANGUAGE_LABELS: Record<SnippetLanguage, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  html: 'HTML',
  css: 'CSS',
  python: 'Python',
  java: 'Java',
  php: 'PHP',
  sql: 'SQL',
  json: 'JSON',
  bash: 'Bash',
  plaintext: 'Plain Text',
}

/** The language selector's options, in {@link LANGUAGE_LABELS} order. */
export const SNIPPET_LANGUAGES: readonly { value: SnippetLanguage; label: string }[] = (
  Object.keys(LANGUAGE_LABELS) as SnippetLanguage[]
).map((value) => ({ value, label: LANGUAGE_LABELS[value] }))

/** `all` keeps every language; any other value narrows the list to one. */
export type LanguageFilter = SnippetLanguage | 'all'

/**
 * Splits the comma-separated tag field into tags: trimmed, empty entries
 * dropped and duplicates removed case-insensitively while keeping the first
 * spelling, so `"React, react , "` becomes `["React"]`.
 */
export function parseTags(text: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []

  for (const part of text.split(',')) {
    const tag = part.trim()

    if (tag === '') {
      continue
    }

    const key = tag.toLowerCase()

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    tags.push(tag)
  }

  return tags
}

/** Renders stored tags back into the comma-separated form the editor shows. */
export function formatTags(tags: readonly string[]): string {
  return tags.join(', ')
}

/**
 * First meaningful line of the code, collapsed so it fits one list row. The
 * title is already on the row above, so the code itself is the useful preview.
 */
export function codePreview(code: string): string {
  const line = code.split('\n').find((entry) => entry.trim() !== '')

  return line ? line.replace(/\s+/g, ' ').trim() : ''
}

/** Lines the code occupies. An empty draft is zero lines, not one. */
export function countLines(code: string): number {
  return code === '' ? 0 : code.split('\n').length
}

/** Case-insensitive match across the title, the code and the tags. */
function matchesQuery(snippet: Snippet, needle: string): boolean {
  return (
    snippet.title.toLowerCase().includes(needle) ||
    snippet.code.toLowerCase().includes(needle) ||
    snippet.tags.some((tag) => tag.toLowerCase().includes(needle))
  )
}

/**
 * Applies the language filter and the search.
 *
 * Ordering is left alone — the workspace owns it — so this stays a pure
 * projection of the collection it is handed.
 */
export function selectSnippets(
  snippets: readonly Snippet[],
  language: LanguageFilter,
  query: string,
): Snippet[] {
  const needle = query.trim().toLowerCase()

  return snippets.filter((snippet) => {
    if (language !== 'all' && snippet.language !== language) {
      return false
    }

    return needle === '' || matchesQuery(snippet, needle)
  })
}
