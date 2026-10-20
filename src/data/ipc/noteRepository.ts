/**
 * x31Desk — the IPC-backed note repository.
 * ---------------------------------------------------------------------------
 * Implements `NoteRepository` over the preload bridge, so the notes workspace
 * runs against the SQLite store in the main process once the desktop shell binds
 * it (see `src/data/desktopStorage.ts`).
 *
 * Each method forwards to the matching channel and unwraps the envelope into the
 * renderer's own `StorageError`, so a failure is indistinguishable from a local
 * one to every caller.
 */

import { unwrapIpcResult } from '@/data/ipc/unwrap'
import type { NoteRepository } from '@/data/repositoryTypes'
import type { DesktopNoteBridge } from '@/types/desktop'
import type { Note, NoteDraft } from '@/types/note'

/**
 * The note repository backed by the main process.
 *
 * `notes` is the preload's published note group; it is passed in rather than
 * reached through a global so the adapter is testable and the application
 * decides when (and whether) to bind it.
 */
export function createIpcNoteRepository(notes: DesktopNoteBridge): NoteRepository {
  return {
    async list() {
      return unwrapIpcResult(await notes.list())
    },

    async create() {
      return unwrapIpcResult(await notes.create())
    },

    async update(id: string, draft: NoteDraft) {
      return unwrapIpcResult(await notes.update({ id, draft }))
    },

    async insert(note: Note) {
      return unwrapIpcResult(await notes.insert({ note }))
    },

    async remove(id: string) {
      unwrapIpcResult(await notes.remove({ id }))
    },

    async clear() {
      unwrapIpcResult(await notes.clear())
    },
  }
}
