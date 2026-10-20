import { preserveUnreadable, QUARANTINE_KEYS } from '@/data/quarantine'
import type { ArchiveRepository } from '@/data/repositoryTypes'
import { runStorageOperation, runStorageRead } from '@/data/storageError'
import { STORAGE_KEYS } from '@/data/storageKeys'
import { archiveKey, archivedRecordId, isArchivedItem, type ArchivedItem, type ArchiveItemType } from '@/types/archive'

/**
 * The archive store the interface talks to, defined in `repositoryTypes.ts` so
 * the SQLite adapter can share it without pulling `localStorage` into the main
 * process. Re-exported here so existing importers are unaffected.
 */
export type { ArchiveRepository }

const STORAGE_KEY = STORAGE_KEYS.archive
const QUARANTINE_KEY = QUARANTINE_KEYS.archive

/**
 * Preserves a payload we could not fully understand instead of destroying it.
 * Delegates to the shared helper so the write-once policy and the key itself
 * live in one place; see `quarantine.ts`.
 */
function quarantine(raw: string): void {
  preserveUnreadable(QUARANTINE_KEY, raw)
}

/**
 * Reads the whole archive defensively.
 *
 * Missing, empty, malformed or partially invalid data all resolve to a usable
 * array — the archive must never fail to open because of its own storage.
 */
function readArchive(): ArchivedItem[] {
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

  const items = parsed.filter(isArchivedItem)

  // Keep the original bytes whenever entries had to be dropped, so nothing the
  // user set aside disappears without a trace.
  if (items.length !== parsed.length) {
    quarantine(raw)
  }

  return items
}

function writeArchive(items: readonly ArchivedItem[]): void {
  runStorageOperation(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  })
}

/**
 * The localStorage-backed repository.
 *
 * Each mutation re-reads the stored archive and writes it back in a single
 * synchronous burst before the returned promise settles, matching the active
 * repositories. That keeps concurrent moves from clobbering one another and
 * means a write is already durable by the time the promise resolves.
 */
export function createLocalArchiveRepository(): ArchiveRepository {
  return {
    async list() {
      return readArchive()
    },

    async add(entry) {
      const items = readArchive()
      const key = archiveKey(entry.type, archivedRecordId(entry))
      const index = items.findIndex(
        (item) => archiveKey(item.type, archivedRecordId(item)) === key,
      )

      if (index === -1) {
        writeArchive([entry, ...items])
      } else {
        const next = [...items]
        next[index] = entry
        writeArchive(next)
      }

      return entry
    },

    async remove(type, id) {
      const key = archiveKey(type, id)

      writeArchive(
        readArchive().filter(
          (item) => archiveKey(item.type, archivedRecordId(item)) !== key,
        ),
      )
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
 * The active archive store. It starts as the in-browser `localStorage` one — so
 * the web build and a plain browser are completely unchanged — and the desktop
 * shell rebinds it to the SQLite store in the main process, once, before the
 * workspace is first read (see `src/data/desktopStorage.ts`).
 */
let activeArchiveRepository: ArchiveRepository = createLocalArchiveRepository()

/** Points the archive at another implementation. See `bindNoteRepository`. */
export function bindArchiveRepository(repository: ArchiveRepository): void {
  activeArchiveRepository = repository
}

/** Returns the archive to the in-browser implementation. Used by tests. */
export function resetArchiveRepository(): void {
  activeArchiveRepository = createLocalArchiveRepository()
}

/**
 * The repository the application uses.
 *
 * Every call is forwarded to whichever implementation is currently bound, so a
 * consumer — which imports this one stable object — keeps working whether the
 * data lives in `localStorage` or in the main process.
 */
export const archiveRepository: ArchiveRepository = {
  list: () => activeArchiveRepository.list(),
  add: (entry: ArchivedItem) => activeArchiveRepository.add(entry),
  remove: (type: ArchiveItemType, id: string) => activeArchiveRepository.remove(type, id),
  clear: () => activeArchiveRepository.clear(),
}
