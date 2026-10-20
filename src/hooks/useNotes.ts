import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { archiveStore } from '@/data/archiveStore'
import { subscribeToStorageKeys } from '@/data/crossTabSync'
import { noteRepository, type NoteRepository } from '@/data/noteRepository'
import { readStable } from '@/data/readStable'
import { saveQueue } from '@/data/saveQueue'
import { STORAGE_KEYS } from '@/data/storageKeys'
import {
  classifyStorageError,
  getLastStorageErrorKind,
  storageErrorSummary,
  type StorageErrorKind,
} from '@/data/storageError'
import type { Note, NoteDraft } from '@/types/note'

/** Progress of the automatic save cycle for the notes workspace. */
export type NoteSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * How long the editor waits after the last keystroke before writing. Short
 * enough to feel immediate, long enough that typing a sentence is one write.
 */
const SAVE_DELAY_MS = 500

/** The queue key for one note, so it never collides with another workspace's. */
function keyFor(id: string): string {
  return `note:${id}`
}

type PendingEdit = {
  id: string
  draft: NoteDraft
}

/** Most recently updated first. */
function byUpdatedAtDesc(a: Note, b: Note): number {
  return b.updatedAt - a.updatedAt
}

/**
 * Owns the notes collection and its persistence.
 *
 * The in-memory list mirrors storage and is updated optimistically while the
 * user types, so the editor and the list never lag behind the keyboard. Only
 * `updatedAt` waits for the debounced write — that is what keeps the list from
 * re-ordering itself on every keystroke, and what makes a save observable.
 *
 * Writes go through the shared {@link saveQueue}: it holds the latest draft per
 * note, serializes overlapping writes and exposes an awaitable flush. A pending
 * edit is never cancelled by a mere navigation, only written early; but a record
 * that is being deleted or archived has its queued write cancelled first, so a
 * debounced save can never bring it back.
 */
export function useNotes(repository: NoteRepository = noteRepository) {
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<NoteSaveStatus>('idle')
  // Why the last write failed, so the editor can say more than "Not saved".
  const [errorKind, setErrorKind] = useState<StorageErrorKind | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  /**
   * Mirrors the latest draft scheduled for storage. The queue holds the real
   * pending write; this exists only so a storage re-read can layer the unsaved
   * edit back on, because storage does not hold it yet.
   */
  const pendingRef = useRef<PendingEdit | null>(null)
  // Notes being deleted or archived. A keystroke for one of these is ignored, so
  // it cannot re-queue a write for a record that is on its way out.
  const removingRef = useRef<Set<string>>(new Set())
  // Bumped after every write that changes the collection. The initial load
  // consults it so a create, edit, delete or archive that lands while the read
  // is in flight is never overwritten by the stale result.
  const revisionRef = useRef(0)

  // Keeps the injected implementation reachable from callbacks that must stay
  // referentially stable.
  const repositoryRef = useRef(repository)

  useEffect(() => {
    repositoryRef.current = repository
  }, [repository])

  /**
   * Records a failed write so the editor can explain it. The kind is kept
   * rather than a message: the wording lives in one place, and `unknown`
   * degrades to the plain "Not saved" indicator.
   */
  const reportStorageFailure = useCallback((error: unknown) => {
    setErrorKind(classifyStorageError(error))
    setStatus('error')
  }, [])

  /**
   * Writes one draft and folds the stored result back into the list. Rethrows on
   * failure so the queue records it and `flush` can report it; the failure is
   * also surfaced to the editor here.
   */
  const saveNote = useCallback(
    async (id: string, draft: NoteDraft): Promise<void> => {
      let updated: Note | null

      try {
        updated = await repositoryRef.current.update(id, draft)
      } catch (error) {
        reportStorageFailure(error)
        throw error
      }

      if (updated) {
        revisionRef.current += 1

        setNotes((current) => current.map((note) => (note.id === updated.id ? updated : note)))
      }

      // A newer keystroke may already have queued the next write; in that case
      // the status belongs to that write, not this one.
      if (!saveQueue.hasScheduled(keyFor(id))) {
        pendingRef.current = null
        setStatus('saved')
      }
    },
    [reportStorageFailure],
  )

  /** Writes every pending edit now, without waiting for the debounce. */
  const flush = useCallback(() => {
    void saveQueue.flushAll().catch(() => undefined)
  }, [])

  /**
   * Seeds the workspace from a storage read.
   *
   * The read may have started before a mutation landed, so an edit still inside
   * the debounce window is layered back on: storage does not hold it yet, and
   * dropping it here would make the user's last keystrokes vanish until the
   * debounced write catches up.
   */
  const seedFromStorage = useCallback((stored: Note[]) => {
    const pending = pendingRef.current

    setNotes(() =>
      pending
        ? stored.map((note) =>
            note.id === pending.id
              ? { ...note, title: pending.draft.title, content: pending.draft.content }
              : note,
          )
        : stored,
    )
    setIsLoading(false)

    // Reopen the most recently updated note, so returning to the workspace lands
    // on something writable. `??` keeps a selection made in the meantime (and
    // keeps a double-invoked effect idempotent).
    const mostRecent = [...stored].sort(byUpdatedAtDesc)[0]
    if (mostRecent) {
      setSelectedId((current) => current ?? mostRecent.id)
    }
  }, [])

  // Initial load. The repository is asynchronous, so the workspace renders a
  // neutral loading state instead of briefly claiming there are no notes. The
  // read is retried if a mutation lands while it is in flight, so a note created
  // (or removed) before it resolves is never dropped by the stale result.
  useEffect(() => {
    let active = true

    readStable(
      () => repositoryRef.current.list(),
      () => revisionRef.current,
      (stored) => {
        if (active) {
          seedFromStorage(stored)
        }
      },
    ).catch(() => {
      if (active) {
        setIsLoading(false)
      }
    })

    return () => {
      active = false
    }
  }, [seedFromStorage])

  // Leaving the view, or closing/reloading the window, must not drop an edit
  // that is still inside its debounce window. This is the best-effort path; the
  // Electron close handshake is the durable one.
  useEffect(() => {
    const handleBeforeUnload = () => {
      flush()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      flush()
    }
  }, [flush])

  // Another tab changed the notes collection on disk. Re-read and fold it in,
  // keeping whatever is still inside this tab's debounce window (layered back on
  // by `seedFromStorage`) and the current selection. The read runs through
  // `readStable`, so a local save landing mid-read is not overwritten.
  useEffect(() => {
    return subscribeToStorageKeys([STORAGE_KEYS.notes], () => {
      void readStable(
        () => repositoryRef.current.list(),
        () => revisionRef.current,
        (stored) => seedFromStorage(stored),
      ).catch(() => {
        // Storage unavailable: keep the current list rather than blanking it.
      })
    })
  }, [seedFromStorage])

  /** Most recently updated first. */
  const sortedNotes = useMemo(() => [...notes].sort(byUpdatedAtDesc), [notes])

  const selectedNote = useMemo(
    () => sortedNotes.find((note) => note.id === selectedId) ?? null,
    [sortedNotes, selectedId],
  )

  /**
   * Stops a queued write for a record that is leaving the workspace, and waits
   * for any write already in flight so it lands before the record is removed.
   * A failed pending write is already reported; the caller proceeds regardless.
   */
  const settleBeforeRemoval = useCallback(async (id: string): Promise<void> => {
    removingRef.current.add(id)
    saveQueue.cancel(keyFor(id))

    if (pendingRef.current?.id === id) {
      pendingRef.current = null
      // The record is leaving, so the editor has nothing to report saving.
      setStatus('idle')
    }

    try {
      await saveQueue.flush(keyFor(id))
    } catch {
      // The queued write failed and was reported; there is nothing more to save.
    }
  }, [])

  /** Opens a note, saving whatever the previous one still owed. */
  const selectNote = useCallback(
    (id: string) => {
      flush()
      setSelectedId(id)
    },
    [flush],
  )

  /** Creates an empty note, opens it and resolves with its id. */
  const createNote = useCallback(async (): Promise<string | null> => {
    flush()

    try {
      const note = await repositoryRef.current.create()
      revisionRef.current += 1
      setNotes((current) => [note, ...current])
      setSelectedId(note.id)
      return note.id
    } catch (error) {
      reportStorageFailure(error)
      return null
    }
  }, [flush, reportStorageFailure])

  /** Records a keystroke and schedules the write. */
  const editNote = useCallback(
    (id: string, draft: NoteDraft) => {
      // A keystroke for a note that is being removed must not re-queue a write.
      if (removingRef.current.has(id)) {
        return
      }

      setNotes((current) =>
        current.map((note) =>
          note.id === id ? { ...note, title: draft.title, content: draft.content } : note,
        ),
      )

      pendingRef.current = { id, draft }
      setStatus('saving')

      saveQueue.schedule(keyFor(id), SAVE_DELAY_MS, () => saveNote(id, draft))
    },
    [saveNote],
  )

  /** Deletes a note and moves the selection to its neighbour. */
  const deleteNote = useCallback(
    async (id: string): Promise<boolean> => {
      await settleBeforeRemoval(id)

      try {
        await repositoryRef.current.remove(id)
      } catch (error) {
        removingRef.current.delete(id)
        reportStorageFailure(error)
        return false
      }

      removingRef.current.delete(id)
      revisionRef.current += 1

      const index = sortedNotes.findIndex((note) => note.id === id)
      const neighbour =
        index === -1 ? null : (sortedNotes[index + 1]?.id ?? sortedNotes[index - 1]?.id ?? null)

      setNotes((current) => current.filter((note) => note.id !== id))
      setSelectedId((current) => (current === id ? neighbour : current))

      return true
    },
    [settleBeforeRemoval, reportStorageFailure, sortedNotes],
  )

  /**
   * Archives a note: moves it out of the notes workspace and into the archive,
   * then moves the selection to its neighbour.
   *
   * The in-memory note already carries the latest keystrokes (the editor updates
   * it optimistically), so that is what is archived. The queued write is
   * cancelled and any in-flight write is awaited first, so nothing can write the
   * note back after the archive has removed it.
   */
  const archiveNote = useCallback(
    async (id: string): Promise<boolean> => {
      const note = sortedNotes.find((candidate) => candidate.id === id)

      if (!note) {
        return false
      }

      await settleBeforeRemoval(id)

      const archived = await archiveStore.archiveNote(note)

      removingRef.current.delete(id)

      if (!archived) {
        setErrorKind(getLastStorageErrorKind() ?? 'unknown')
        setStatus('error')
        return false
      }

      revisionRef.current += 1

      const index = sortedNotes.findIndex((candidate) => candidate.id === id)
      const neighbour =
        index === -1 ? null : (sortedNotes[index + 1]?.id ?? sortedNotes[index - 1]?.id ?? null)

      setNotes((current) => current.filter((candidate) => candidate.id !== id))
      setSelectedId((current) => (current === id ? neighbour : current))

      return true
    },
    [settleBeforeRemoval, sortedNotes],
  )

  return {
    /** Newest first. */
    notes: sortedNotes,
    selectedId,
    selectedNote,
    status,
    errorSummary: storageErrorSummary(errorKind),
    isLoading,
    createNote,
    selectNote,
    editNote,
    deleteNote,
    archiveNote,
  }
}
