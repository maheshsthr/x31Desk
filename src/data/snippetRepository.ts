import { preserveUnreadable, QUARANTINE_KEYS } from '@/data/quarantine'
import type { SnippetRepository } from '@/data/repositoryTypes'
import { runStorageOperation, runStorageRead } from '@/data/storageError'
import { STORAGE_KEYS } from '@/data/storageKeys'
import { isSnippet, type Snippet, type SnippetDraft } from '@/types/snippet'
import { createId } from '@/utils/id'
import { parseTags } from '@/utils/snippet'

/**
 * The snippet store the interface talks to, defined in `repositoryTypes.ts` so
 * the SQLite adapter can share it without pulling `localStorage` into the main
 * process. Re-exported here so existing importers are unaffected.
 */
export type { SnippetRepository }

const STORAGE_KEY = STORAGE_KEYS.snippets
const QUARANTINE_KEY = QUARANTINE_KEYS.snippets

/**
 * Preserves a payload we could not fully understand instead of destroying it.
 * Delegates to the shared helper so the write-once policy and the key itself
 * live in one place; see `quarantine.ts`.
 */
function quarantine(raw: string): void {
  preserveUnreadable(QUARANTINE_KEY, raw)
}

/**
 * Reads the whole collection defensively.
 *
 * Missing, empty, malformed or partially invalid data all resolve to a usable
 * array — the snippets workspace must never fail to open because of its own
 * storage.
 */
function readSnippets(): Snippet[] {
  // Storage being disabled (private mode, hardened browser) behaves as empty.
  const raw = runStorageRead(() => window.localStorage.getItem(STORAGE_KEY), null)

  if (raw === null || raw === '') {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    quarantine(raw)
    return []
  }

  if (!Array.isArray(parsed)) {
    quarantine(raw)
    return []
  }

  const snippets = parsed.filter(isSnippet)

  // Keep the original bytes whenever entries had to be dropped, so nothing the
  // user wrote disappears without a trace.
  if (snippets.length !== parsed.length) {
    quarantine(raw)
  }

  return snippets
}

function writeSnippets(snippets: readonly Snippet[]): void {
  runStorageOperation(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets))
  })
}

/**
 * The localStorage-backed repository.
 *
 * Each mutation re-reads the stored collection and writes it back in a single
 * synchronous burst before the returned promise settles, matching the notes and
 * tasks repositories. That keeps concurrent edits from clobbering one another
 * and means a write is already durable by the time the promise resolves.
 */
export function createLocalSnippetRepository(): SnippetRepository {
  return {
    async list() {
      return readSnippets()
    },

    async create(draft) {
      const now = Date.now()
      const snippet: Snippet = {
        id: createId(),
        title: draft.title,
        code: draft.code,
        language: draft.language,
        tags: parseTags(draft.tags),
        createdAt: now,
        updatedAt: now,
      }

      writeSnippets([...readSnippets(), snippet])

      return snippet
    },

    async update(id, draft) {
      const snippets = readSnippets()
      const existing = snippets.find((snippet) => snippet.id === id)

      if (!existing) {
        return null
      }

      const updated: Snippet = {
        ...existing,
        title: draft.title,
        code: draft.code,
        language: draft.language,
        tags: parseTags(draft.tags),
        updatedAt: Date.now(),
      }

      writeSnippets(snippets.map((snippet) => (snippet.id === id ? updated : snippet)))

      return updated
    },

    async insert(snippet) {
      const snippets = readSnippets()
      const index = snippets.findIndex((candidate) => candidate.id === snippet.id)

      if (index === -1) {
        writeSnippets([...snippets, snippet])
      } else {
        const next = [...snippets]
        next[index] = snippet
        writeSnippets(next)
      }

      return snippet
    },

    async remove(id) {
      writeSnippets(readSnippets().filter((snippet) => snippet.id !== id))
    },

    async clear() {
      runStorageOperation(() => {
        window.localStorage.removeItem(STORAGE_KEY)
        window.localStorage.removeItem(QUARANTINE_KEY)
      })
    },
  }
}

/**
 * The active snippet store. It starts as the in-browser `localStorage` one — so
 * the web build and a plain browser are completely unchanged — and the desktop
 * shell rebinds it to the SQLite store in the main process, once, before the
 * workspace is first read (see `src/data/desktopStorage.ts`).
 */
let activeSnippetRepository: SnippetRepository = createLocalSnippetRepository()

/** Points the snippet store at another implementation. See `bindNoteRepository`. */
export function bindSnippetRepository(repository: SnippetRepository): void {
  activeSnippetRepository = repository
}

/** Returns the snippet store to the in-browser implementation. Used by tests. */
export function resetSnippetRepository(): void {
  activeSnippetRepository = createLocalSnippetRepository()
}

/**
 * The repository the application uses.
 *
 * Every call is forwarded to whichever implementation is currently bound, so a
 * consumer — which imports this one stable object — keeps working whether the
 * data lives in `localStorage` or in the main process.
 */
export const snippetRepository: SnippetRepository = {
  list: () => activeSnippetRepository.list(),
  create: (draft: SnippetDraft) => activeSnippetRepository.create(draft),
  update: (id: string, draft: SnippetDraft) => activeSnippetRepository.update(id, draft),
  insert: (snippet: Snippet) => activeSnippetRepository.insert(snippet),
  remove: (id: string) => activeSnippetRepository.remove(id),
  clear: () => activeSnippetRepository.clear(),
}
