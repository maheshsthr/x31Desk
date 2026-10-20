import { useEffect, useState } from 'react'

import { subscribeToStorageKeys } from '@/data/crossTabSync'
import { noteRepository } from '@/data/noteRepository'
import { STORAGE_KEYS } from '@/data/storageKeys'

/**
 * Reads how many notes exist, for summaries outside the notes workspace.
 *
 * A read-only companion to `useNotes`: pages that only need to report a number
 * should not have to hold the editor's selection and save state to get it. It
 * re-reads when another tab changes the collection, so a dashboard count does
 * not go stale while this tab sits on another view.
 */
export function useNoteCount(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let active = true

    const read = () => {
      noteRepository
        .list()
        .then((notes) => {
          if (active) {
            setCount(notes.length)
          }
        })
        .catch(() => {
          // Storage unavailable: the overview reports zero rather than failing.
        })
    }

    read()

    const unsubscribe = subscribeToStorageKeys([STORAGE_KEYS.notes], read)

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return count
}
