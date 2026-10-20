import type { ArchivedItem } from '@/types/archive'
import type { Note } from '@/types/note'
import type {
  SearchGroup,
  SearchResult,
  SearchResults,
  WorkspaceDocuments,
} from '@/types/search'
import type { Snippet } from '@/types/snippet'
import type { Task } from '@/types/task'
import {
  ARCHIVE_TYPE_LABELS,
  archivedPreview,
  archivedTitle,
} from '@/utils/archive'
import { LANGUAGE_LABELS, codePreview } from '@/utils/snippet'

/**
 * The documents the search starts from, and the results for an empty query.
 *
 * Both are module constants so their identity is stable: the search hook seeds
 * its state from the first and returns the second for no query, which keeps the
 * dropdown from re-rendering just because a component rendered again.
 */
export const EMPTY_DOCUMENTS: WorkspaceDocuments = {
  notes: [],
  tasks: [],
  snippets: [],
  archive: [],
}

const EMPTY_RESULTS: SearchResults = { groups: [], flat: [], total: 0 }

/** How many matches a section shows before the rest are summarised. */
const RESULTS_PER_GROUP = 5

/** First meaningful line of a block of text, collapsed to one line. */
function firstLine(text: string): string {
  const line = text.split('\n').find((entry) => entry.trim() !== '')

  return line ? line.replace(/\s+/g, ' ').trim() : ''
}

/** Case-insensitive description match — notes and tasks search title plus body. */
function noteMatches(note: Note, needle: string): boolean {
  return note.title.toLowerCase().includes(needle) || note.content.toLowerCase().includes(needle)
}

function taskMatches(task: Task, needle: string): boolean {
  return task.title.toLowerCase().includes(needle) || task.description.toLowerCase().includes(needle)
}

/**
 * Snippets are findable by title, code, tags and the display name of their
 * language, so typing `python` surfaces every Python snippet even though that
 * word is not stored anywhere on the record.
 */
function snippetMatches(snippet: Snippet, needle: string): boolean {
  return (
    snippet.title.toLowerCase().includes(needle) ||
    snippet.code.toLowerCase().includes(needle) ||
    snippet.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
    LANGUAGE_LABELS[snippet.language].toLowerCase().includes(needle)
  )
}

function archivedMatches(item: ArchivedItem, needle: string): boolean {
  switch (item.type) {
    case 'note':
      return noteMatches(item.note, needle)
    case 'task':
      return taskMatches(item.task, needle)
    case 'snippet':
      return snippetMatches(item.snippet, needle)
  }
}

/**
 * Orders matches so a title hit outranks a body-only hit, and ties break by
 * recency. A search for "roadmap" should surface the note *called* Roadmap
 * before the meeting notes that merely mention it.
 */
function rank<T>(
  items: readonly T[],
  needle: string,
  titleOf: (item: T) => string,
  timeOf: (item: T) => number,
): T[] {
  return [...items].sort((a, b) => {
    const aTitle = titleOf(a).toLowerCase().includes(needle) ? 1 : 0
    const bTitle = titleOf(b).toLowerCase().includes(needle) ? 1 : 0

    if (aTitle !== bTitle) {
      return bTitle - aTitle
    }

    return timeOf(b) - timeOf(a)
  })
}

function toNoteResult(note: Note): SearchResult {
  return {
    kind: 'note',
    id: note.id,
    title: note.title.trim() || 'Untitled note',
    preview: firstLine(note.content),
  }
}

function toTaskResult(task: Task): SearchResult {
  return {
    kind: 'task',
    id: task.id,
    title: task.title.trim() || 'Untitled task',
    preview: task.description.replace(/\s+/g, ' ').trim(),
  }
}

function toSnippetResult(snippet: Snippet): SearchResult {
  return {
    kind: 'snippet',
    id: snippet.id,
    title: snippet.title.trim() || 'Untitled snippet',
    preview: codePreview(snippet.code),
    meta: LANGUAGE_LABELS[snippet.language],
  }
}

function toArchiveResult(item: ArchivedItem): SearchResult {
  return {
    kind: 'archive',
    // The wrapped record keeps its own id, which is also what a restore reuses.
    id: item.type === 'note' ? item.note.id : item.type === 'task' ? item.task.id : item.snippet.id,
    title: archivedTitle(item),
    preview: archivedPreview(item),
    meta: ARCHIVE_TYPE_LABELS[item.type],
  }
}

/**
 * Everything the workspace search found for one query, grouped by workspace.
 *
 * Pure and synchronous: it is handed the documents and returns the dropdown's
 * contents, so results update on every keystroke without touching storage
 * again. Archived records are searched in their own section — they are no
 * longer in their home collections, and this is what keeps them findable
 * instead of silently unreachable.
 */
export function buildSearchResults(
  documents: WorkspaceDocuments,
  query: string,
): SearchResults {
  const needle = query.trim().toLowerCase()

  if (needle === '') {
    return EMPTY_RESULTS
  }

  const noteResults = rank(
    documents.notes.filter((note) => noteMatches(note, needle)),
    needle,
    (note) => note.title,
    (note) => note.updatedAt,
  ).map(toNoteResult)

  const taskResults = rank(
    documents.tasks.filter((task) => taskMatches(task, needle)),
    needle,
    (task) => task.title,
    (task) => task.updatedAt,
  ).map(toTaskResult)

  const snippetResults = rank(
    documents.snippets.filter((snippet) => snippetMatches(snippet, needle)),
    needle,
    (snippet) => snippet.title,
    (snippet) => snippet.updatedAt,
  ).map(toSnippetResult)

  const archiveResults = rank(
    documents.archive.filter((item) => archivedMatches(item, needle)),
    needle,
    archivedTitle,
    (item) => item.archivedAt,
  ).map(toArchiveResult)

  const sources: readonly { kind: SearchGroup['kind']; label: string; results: SearchResult[] }[] = [
    { kind: 'note', label: 'Notes', results: noteResults },
    { kind: 'task', label: 'Tasks', results: taskResults },
    { kind: 'snippet', label: 'Snippets', results: snippetResults },
    { kind: 'archive', label: 'Archive', results: archiveResults },
  ]

  const groups: SearchGroup[] = []
  const flat: SearchResult[] = []

  for (const source of sources) {
    if (source.results.length === 0) {
      continue
    }

    const entries = source.results.slice(0, RESULTS_PER_GROUP).map((result) => {
      const index = flat.length
      flat.push(result)

      return { result, index }
    })

    groups.push({ kind: source.kind, label: source.label, entries, total: source.results.length })
  }

  return {
    groups,
    flat,
    total:
      noteResults.length + taskResults.length + snippetResults.length + archiveResults.length,
  }
}
