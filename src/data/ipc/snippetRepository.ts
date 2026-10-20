/**
 * x31Desk — the IPC-backed snippet repository.
 * ---------------------------------------------------------------------------
 * Implements `SnippetRepository` over the preload bridge, so the snippets
 * workspace runs against the SQLite store in the main process once the desktop
 * shell binds it (see `src/data/desktopStorage.ts`).
 *
 * A draft's tag field is forwarded as the raw editor text; the main process
 * parses it exactly as the `localStorage` adapter does.
 */

import { unwrapIpcResult } from '@/data/ipc/unwrap'
import type { SnippetRepository } from '@/data/repositoryTypes'
import type { DesktopSnippetBridge } from '@/types/desktop'
import type { Snippet, SnippetDraft } from '@/types/snippet'

/** The snippet repository backed by the main process. */
export function createIpcSnippetRepository(snippets: DesktopSnippetBridge): SnippetRepository {
  return {
    async list() {
      return unwrapIpcResult(await snippets.list())
    },

    async create(draft: SnippetDraft) {
      return unwrapIpcResult(await snippets.create({ draft }))
    },

    async update(id: string, draft: SnippetDraft) {
      return unwrapIpcResult(await snippets.update({ id, draft }))
    },

    async insert(snippet: Snippet) {
      return unwrapIpcResult(await snippets.insert({ snippet }))
    },

    async remove(id: string) {
      unwrapIpcResult(await snippets.remove({ id }))
    },

    async clear() {
      unwrapIpcResult(await snippets.clear())
    },
  }
}
