import { useSyncExternalStore } from 'react'

import { archiveStore } from '@/data/archiveStore'

/**
 * The archive workspace API: the shared collection plus every mutation.
 *
 * Thin on purpose. All of the state and the safe cross-module moves live in the
 * store, so the Archive page observes the same archive the notes, tasks and
 * snippets workspaces write to — archiving in one is visible in the other
 * immediately, never on the next reload.
 */
export function useArchive() {
  const snapshot = useSyncExternalStore(archiveStore.subscribe, archiveStore.getSnapshot)

  return {
    items: snapshot.items,
    isLoading: snapshot.isLoading,
    restore: archiveStore.restore,
    deleteForever: archiveStore.deleteForever,
  }
}
