import { useCallback, useEffect, useRef, useState } from 'react'

import { archiveRepository } from '@/data/archiveRepository'
import { subscribeToStorageKeys, WORKSPACE_COLLECTION_KEYS } from '@/data/crossTabSync'
import { noteRepository } from '@/data/noteRepository'
import { snippetRepository } from '@/data/snippetRepository'
import { taskRepository } from '@/data/taskRepository'
import type { WorkspaceDocuments } from '@/types/search'
import { EMPTY_DOCUMENTS } from '@/utils/search'

/**
 * Loads everything the workspace search can find.
 *
 * The search reads the repositories rather than any one page's state: it has to
 * see all four collections at once, and the notes and snippets workspaces keep
 * their data to themselves. The repositories are the source of truth for all of
 * them, so one read is the whole workspace.
 *
 * `refresh` exists because the top bar outlives every page. A note edited a
 * moment ago is still settling in the repository when the search is focused, so
 * the dropdown re-reads on open instead of trusting the snapshot it loaded when
 * the application started.
 */
export function useWorkspaceSearch() {
  const [documents, setDocuments] = useState<WorkspaceDocuments>(EMPTY_DOCUMENTS)
  const [isLoading, setIsLoading] = useState(true)

  // Guards against an out-of-order resolve: a slow first load must not
  // overwrite a newer refresh that already landed.
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    const request = requestRef.current + 1
    requestRef.current = request

    try {
      const [notes, tasks, snippets, archive] = await Promise.all([
        noteRepository.list(),
        taskRepository.list(),
        snippetRepository.list(),
        archiveRepository.list(),
      ])

      if (request === requestRef.current) {
        setDocuments({ notes, tasks, snippets, archive })
      }
    } finally {
      // Only the initial read drives the loading state; a refresh keeps showing
      // the previous matches rather than flashing a spinner over them.
      if (request === requestRef.current) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The top bar outlives every page, so a change made in another tab would
  // otherwise stay invisible here until a manual refresh. Re-read whenever any
  // collection changes elsewhere; `refresh` already discards an out-of-order
  // resolve, so overlapping reads cannot regress the results.
  useEffect(() => {
    return subscribeToStorageKeys(WORKSPACE_COLLECTION_KEYS, () => {
      void refresh()
    })
  }, [refresh])

  return { documents, isLoading, refresh }
}
