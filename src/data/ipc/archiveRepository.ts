/**
 * x31Desk — the IPC-backed archive repository.
 * ---------------------------------------------------------------------------
 * Implements `ArchiveRepository` over the preload bridge, so the archive runs
 * against the SQLite store in the main process once the desktop shell binds it
 * (see `src/data/desktopStorage.ts`).
 *
 * `add` sends the whole entry; the main process keys it by kind and record id so
 * a duplicate cannot be stored.
 */

import { unwrapIpcResult } from '@/data/ipc/unwrap'
import type { ArchiveRepository } from '@/data/repositoryTypes'
import type { ArchivedItem, ArchiveItemType } from '@/types/archive'
import type { DesktopArchiveBridge } from '@/types/desktop'

/** The archive backed by the main process. */
export function createIpcArchiveRepository(archive: DesktopArchiveBridge): ArchiveRepository {
  return {
    async list() {
      return unwrapIpcResult(await archive.list())
    },

    async add(entry: ArchivedItem) {
      return unwrapIpcResult(await archive.add({ entry }))
    },

    async remove(type: ArchiveItemType, id: string) {
      unwrapIpcResult(await archive.remove({ type, id }))
    },

    async clear() {
      unwrapIpcResult(await archive.clear())
    },
  }
}
