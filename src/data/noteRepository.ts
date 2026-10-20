import { preserveUnreadable, QUARANTINE_KEYS } from '@/data/quarantine'
import type { NoteRepository } from '@/data/repositoryTypes'
import { runStorageOperation, runStorageRead } from '@/data/storageError'
import { STORAGE_KEYS } from '@/data/storageKeys'
import { isNote, type Note, type NoteDraft } from '@/types/note'
import { createId } from '@/utils/id'

/**
 * The note store the interface talks to, defined in `repositoryTypes.ts` so the
 * SQLite adapter can share it without pulling `localStorage` into the main
 * process. Re-exported here so existing importers are unaffected.
 */
export type { NoteRepository }

const STORAGE_KEY = STORAGE_KEYS.notes
const QUARANTINE_KEY = QUARANTINE_KEYS.notes

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
 * array — the notes workspace must never fail to open because of its own
 * storage.
 */
function readNotes(): Note[] {
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

  const notes = parsed.filter(isNote)

  // Keep the original bytes whenever entries had to be dropped, so nothing the
  // user wrote disappears without a trace.
  if (notes.length !== parsed.length) {
    quarantine(raw)
  }

  return notes
}

function writeNotes(notes: readonly Note[]): void {
  runStorageOperation(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes))
  })
}

/**
 * The localStorage-backed repository.
 *
 * Each mutation re-reads the stored collection and writes it back in a single
 * synchronous burst before the returned promise settles. That matters: it keeps
 * concurrent edits from clobbering one another and lets the UI flush a pending
 * edit on window unload, where a real asynchronous round-trip would be lost.
 */
export function createLocalNoteRepository(): NoteRepository {
  return {
    async list() {
      return readNotes()
    },

    async create() {
      const now = Date.now()
      const note: Note = {
        id: createId(),
        title: '',
        content: '',
        createdAt: now,
        updatedAt: now,
      }

      writeNotes([...readNotes(), note])

      return note
    },

    async update(id, draft) {
      const notes = readNotes()
      const existing = notes.find((note) => note.id === id)

      if (!existing) {
        return null
      }

      const updated: Note = {
        ...existing,
        title: draft.title,
        content: draft.content,
        updatedAt: Date.now(),
      }

      writeNotes(notes.map((note) => (note.id === id ? updated : note)))

      return updated
    },

    async insert(note) {
      const notes = readNotes()
      const index = notes.findIndex((candidate) => candidate.id === note.id)

      if (index === -1) {
        writeNotes([...notes, note])
      } else {
        const next = [...notes]
        next[index] = note
        writeNotes(next)
      }

      return note
    },

    async remove(id) {
      writeNotes(readNotes().filter((note) => note.id !== id))
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
 * The active note store. It starts as the in-browser `localStorage` one — so
 * the web build and a plain browser are completely unchanged — and the desktop
 * shell rebinds it to the SQLite store in the main process, once, before the
 * workspace is first read (see `src/data/desktopStorage.ts`).
 */
let activeNoteRepository: NoteRepository = createLocalNoteRepository()

/**
 * Points the note store at another implementation.
 *
 * Called by the desktop shell once the database has been opened and the
 * one-time import has completed, so the SQLite store never becomes visible
 * while the old `localStorage` workspace is still the authoritative one.
 */
export function bindNoteRepository(repository: NoteRepository): void {
  activeNoteRepository = repository
}

/** Returns the note store to the in-browser implementation. Used by tests. */
export function resetNoteRepository(): void {
  activeNoteRepository = createLocalNoteRepository()
}

/**
 * The repository the application uses.
 *
 * Every call is forwarded to whichever implementation is currently bound, so a
 * consumer — which imports this one stable object — keeps working whether the
 * data lives in `localStorage` or in the main process. The forwarding happens
 * per call rather than at import time, because the binding is only decided once
 * the shell has finished opening its store.
 */
export const noteRepository: NoteRepository = {
  list: () => activeNoteRepository.list(),
  create: () => activeNoteRepository.create(),
  update: (id: string, draft: NoteDraft) => activeNoteRepository.update(id, draft),
  insert: (note: Note) => activeNoteRepository.insert(note),
  remove: (id: string) => activeNoteRepository.remove(id),
  clear: () => activeNoteRepository.clear(),
}
