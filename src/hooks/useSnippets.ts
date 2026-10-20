import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { archiveStore } from '@/data/archiveStore'
import { subscribeToStorageKeys } from '@/data/crossTabSync'
import { readStable } from '@/data/readStable'
import { saveQueue } from '@/data/saveQueue'
import { snippetRepository, type SnippetRepository } from '@/data/snippetRepository'
import { STORAGE_KEYS } from '@/data/storageKeys'
import {
  classifyStorageError,
  getLastStorageErrorKind,
  storageErrorSummary,
  type StorageErrorKind,
} from '@/data/storageError'
import {
  EMPTY_SNIPPET_DRAFT,
  isSnippetDraftComplete,
  type Snippet,
  type SnippetDraft,
} from '@/types/snippet'
import { formatTags } from '@/utils/snippet'

/** Progress of the automatic save cycle for the snippets workspace. */
export type SnippetSaveStatus = 'idle' | 'incomplete' | 'saving' | 'saved' | 'error'

/**
 * How long the editor waits after the last keystroke before writing. Short
 * enough to feel immediate, long enough that typing a line of code is one write.
 */
const SAVE_DELAY_MS = 500

/** The snippet currently open in the editor. */
type OpenEditor = {
  /**
   * Identifies this open editor, not the snippet. A brand new snippet has no id
   * until it is first written, so the serial is what lets an in-flight save tell
   * whether the user is still looking at the draft it just stored.
   */
  serial: number
  /** The stored snippet's id, or `null` while a new snippet is still unsaved. */
  id: string | null
  draft: SnippetDraft
}

/** A draft waiting to be written. */
type PendingSave = {
  serial: number
  id: string | null
  draft: SnippetDraft
}

/** The queue key for a stored snippet. */
function snippetKey(id: string): string {
  return `snippet:${id}`
}

/**
 * The queue key for a brand new snippet.
 *
 * A snippet that has not been written has no id, so its editor's serial stands
 * in as the key until the first write assigns one. Keying the unsaved draft
 * separately is what stops its first write from ever colliding with an existing
 * snippet's.
 */
function newSnippetKey(serial: number): string {
  return `snippet:new:${serial}`
}

/**
 * Newest first by *creation*, not by last edit.
 *
 * The list is a browsing surface with an autosaving editor beside it, so it
 * must not re-order itself under the pointer while an edit is being written —
 * which is exactly what ordering by `updatedAt` would do.
 */
function byCreatedAtDesc(a: Snippet, b: Snippet): number {
  return b.createdAt - a.createdAt
}

function draftFromSnippet(snippet: Snippet): SnippetDraft {
  return {
    title: snippet.title,
    code: snippet.code,
    language: snippet.language,
    tags: formatTags(snippet.tags),
  }
}

/** Inserts a stored snippet, or replaces it in place so the order is kept. */
function upsert(snippets: readonly Snippet[], stored: Snippet): Snippet[] {
  const index = snippets.findIndex((snippet) => snippet.id === stored.id)

  if (index === -1) {
    return [stored, ...snippets]
  }

  const next = [...snippets]
  next[index] = stored

  return next
}

/**
 * Owns the snippets collection, the open editor and its persistence.
 *
 * Two rules shape everything here:
 *
 *  - **Nothing incomplete is ever written.** A draft missing a title or code is
 *    held in the open editor and reported as unsaved; storage only ever holds
 *    snippets with both, which is why `isSnippet` can insist on them.
 *  - **A brand new snippet does not exist until it is valid.** It has no id
 *    until its first write, so abandoning an empty one leaves nothing behind.
 *
 * Edits are written on a short debounce through the shared {@link saveQueue},
 * which holds the latest draft per snippet, serializes overlapping writes and
 * exposes an awaitable flush. That is what lets a delete or archive stop a
 * queued write from resurrecting the record, and lets the archive wait for the
 * latest draft to land before it reads the snippet back.
 */
export function useSnippets(repository: SnippetRepository = snippetRepository) {
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [editor, setEditor] = useState<OpenEditor | null>(null)
  const [status, setStatus] = useState<SnippetSaveStatus>('idle')
  const [errorKind, setErrorKind] = useState<StorageErrorKind | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const repositoryRef = useRef(repository)
  // Mirrors `editor` synchronously, so a handler can read what is open without
  // waiting for the next render to land.
  const editorRef = useRef<OpenEditor | null>(null)
  const serialRef = useRef(0)
  /**
   * The id a serial's first write assigned, keyed by serial.
   *
   * A draft scheduled while a new snippet was still unsaved carries `id: null`;
   * if the editor is adopted with an id before that draft runs, the write must
   * update the snippet rather than create a second one. This is how it finds
   * that id.
   */
  const adoptedRef = useRef<Map<number, string>>(new Map())
  // Snippets being deleted or archived. A keystroke for one of these is ignored,
  // so it cannot re-queue a write for a record that is on its way out.
  const removingRef = useRef<Set<string>>(new Set())
  // Bumped after every write that changes the collection. The initial load
  // consults it so a snippet created, edited, deleted or archived while the read
  // is in flight is never overwritten by the stale result.
  const revisionRef = useRef(0)

  useEffect(() => {
    repositoryRef.current = repository
  }, [repository])

  /** Single writer for the open editor, keeping the mirror in step. */
  const openEditor = useCallback((next: OpenEditor | null) => {
    editorRef.current = next
    setEditor(next)
  }, [])

  const reportStorageFailure = useCallback((error: unknown) => {
    setErrorKind(classifyStorageError(error))
    setStatus('error')
  }, [])

  /**
   * Writes one draft and folds the stored result back in. Rethrows on failure
   * so the queue records it and `flush` can report it, and so an archive can
   * tell that the snippet was not brought up to date.
   *
   * The id is resolved at execution time: a draft captured while a new snippet
   * was unsaved may run after its first write adopted an id, and then it must
   * update rather than create again.
   */
  const writeSnippet = useCallback(
    async (pending: PendingSave): Promise<void> => {
      const resolvedId = pending.id ?? adoptedRef.current.get(pending.serial) ?? null
      let stored: Snippet | null

      try {
        stored =
          resolvedId === null
            ? await repositoryRef.current.create(pending.draft)
            : await repositoryRef.current.update(resolvedId, pending.draft)
      } catch (error) {
        reportStorageFailure(error)
        throw error
      }

      if (!stored) {
        return
      }

      revisionRef.current += 1
      setSnippets((current) => upsert(current, stored))

      // A brand new snippet only now has an id. Adopt it if the editor is still
      // showing the draft that produced it, and remember it so a later draft for
      // the same editor updates instead of creating.
      adoptedRef.current.set(pending.serial, stored.id)

      const current = editorRef.current

      if (current && current.serial === pending.serial) {
        openEditor({ ...current, id: stored.id })
      }

      // Only speak for the snippet that is still open, and only when nothing
      // newer was queued while this write ran: a newer draft's own write owns the
      // status from here.
      if (editorRef.current?.serial === pending.serial) {
        const scheduledOnNew = saveQueue.hasScheduled(newSnippetKey(pending.serial))
        const scheduledOnId = saveQueue.hasScheduled(snippetKey(stored.id))

        if (!scheduledOnNew && !scheduledOnId) {
          setStatus('saved')
        }
      }
    },
    [openEditor, reportStorageFailure],
  )

  /** Writes every pending draft immediately instead of waiting out the debounce. */
  const flush = useCallback(() => {
    void saveQueue.flushAll().catch(() => undefined)
  }, [])

  useEffect(() => {
    let active = true

    void readStable(
      () => repositoryRef.current.list(),
      () => revisionRef.current,
      (stored) => {
        if (!active) {
          return
        }

        // Reversed before sorting: two snippets written in the same millisecond
        // then tie-break newest-first, because a stable sort preserves the
        // order it is handed for equal keys.
        const ordered = [...stored].reverse().sort(byCreatedAtDesc)
        setSnippets(ordered)
        setIsLoading(false)

        // Land on the most recent snippet so the workspace opens on something
        // readable rather than an empty pane — but only if the user has not
        // already opened or started one while the read was in flight, so the
        // load cannot steal the editor back from them.
        const newest = ordered[0]

        if (newest && editorRef.current === null) {
          serialRef.current += 1
          openEditor({
            serial: serialRef.current,
            id: newest.id,
            draft: draftFromSnippet(newest),
          })
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
  }, [openEditor])

  useEffect(() => {
    const handleBeforeUnload = () => {
      flush()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      // Leaving the view must not lose the last keystrokes.
      flush()
    }
  }, [flush])

  // Another tab changed the snippets collection on disk. Refresh the list only:
  // the open editor's draft is this tab's unsaved work and must not be replaced
  // by another tab's version, and touching `editor` would rebuild the code
  // editor mid-edit. The read is guarded like the initial load, so a local save
  // landing while it is in flight is not overwritten.
  useEffect(() => {
    return subscribeToStorageKeys([STORAGE_KEYS.snippets], () => {
      void readStable(
        () => repositoryRef.current.list(),
        () => revisionRef.current,
        (stored) => {
          // Reversed before sorting for the same same-millisecond tie-break as
          // the initial load.
          setSnippets([...stored].reverse().sort(byCreatedAtDesc))
          setIsLoading(false)
        },
      ).catch(() => {
        // Storage unavailable: keep the current list rather than blanking it.
      })
    })
  }, [])

  const startCreate = useCallback(() => {
    flush()
    serialRef.current += 1
    openEditor({ serial: serialRef.current, id: null, draft: EMPTY_SNIPPET_DRAFT })
    setStatus('idle')
  }, [flush, openEditor])

  const selectSnippet = useCallback(
    (id: string) => {
      const snippet = snippets.find((candidate) => candidate.id === id)

      if (!snippet) {
        return
      }

      flush()
      serialRef.current += 1
      openEditor({ serial: serialRef.current, id, draft: draftFromSnippet(snippet) })
      setStatus('idle')
    },
    [flush, openEditor, snippets],
  )

  const changeDraft = useCallback(
    (draft: SnippetDraft) => {
      const current = editorRef.current

      if (!current) {
        return
      }

      // A keystroke for a snippet that is being removed must not re-queue a
      // write that could bring it back.
      if (current.id !== null && removingRef.current.has(current.id)) {
        return
      }

      openEditor({ ...current, draft })

      const key = current.id === null ? newSnippetKey(current.serial) : snippetKey(current.id)

      if (!isSnippetDraftComplete(draft)) {
        // Hold the edit and say why: an incomplete snippet is never written.
        saveQueue.cancel(key)
        setStatus('incomplete')

        return
      }

      setStatus('saving')

      const pending: PendingSave = { serial: current.serial, id: current.id, draft }
      saveQueue.schedule(key, SAVE_DELAY_MS, () => writeSnippet(pending))
    },
    [openEditor, writeSnippet],
  )

  const deleteSnippet = useCallback(
    async (id: string): Promise<boolean> => {
      // Drop anything queued for this snippet, and wait for a write already in
      // flight, so a scheduled write cannot resurrect it a moment after it is
      // gone.
      removingRef.current.add(id)
      saveQueue.cancel(snippetKey(id))

      try {
        await saveQueue.flush(snippetKey(id))
      } catch {
        // The queued write failed and was reported; there is nothing left to save.
      }

      try {
        await repositoryRef.current.remove(id)
      } catch (error) {
        removingRef.current.delete(id)
        reportStorageFailure(error)

        return false
      }

      removingRef.current.delete(id)
      revisionRef.current += 1

      const index = snippets.findIndex((snippet) => snippet.id === id)
      const neighbour = snippets[index + 1] ?? snippets[index - 1] ?? null

      setSnippets((current) => current.filter((snippet) => snippet.id !== id))

      const current = editorRef.current

      if (current && current.id === id) {
        if (neighbour) {
          serialRef.current += 1
          openEditor({
            serial: serialRef.current,
            id: neighbour.id,
            draft: draftFromSnippet(neighbour),
          })
        } else {
          openEditor(null)
        }

        setStatus('idle')
      }

      return true
    },
    [openEditor, reportStorageFailure, snippets],
  )

  /**
   * Archives a snippet: moves it out of the snippets workspace and into the
   * archive, then moves the open editor to its neighbour.
   *
   * Unlike a delete, the content matters, so any pending edit is *flushed* —
   * awaited, not merely started — and the record is read back from storage only
   * once that write has settled. The in-memory list only learns about an edit
   * once it has been saved, so the re-read is what makes the archived copy the
   * latest one. Only then is the snippet archived.
   */
  const archiveSnippet = useCallback(
    async (id: string): Promise<boolean> => {
      removingRef.current.add(id)

      try {
        // Persist the latest draft and wait for it — including a write already in
        // flight — before reading the snippet back. A failure here is already
        // reported, and archiving a stale copy would lose the edit, so stop.
        await saveQueue.flush(snippetKey(id))
      } catch {
        removingRef.current.delete(id)

        return false
      }

      const stored = await repositoryRef.current.list()
      const target = stored.find((snippet) => snippet.id === id) ?? null

      if (!target) {
        removingRef.current.delete(id)

        return false
      }

      // Nothing is left to save into a snippet that is leaving the workspace.
      saveQueue.cancel(snippetKey(id))

      const archived = await archiveStore.archiveSnippet(target)

      removingRef.current.delete(id)

      if (!archived) {
        setErrorKind(getLastStorageErrorKind() ?? 'unknown')
        setStatus('error')
        return false
      }

      revisionRef.current += 1

      const index = snippets.findIndex((snippet) => snippet.id === id)
      const neighbour = snippets[index + 1] ?? snippets[index - 1] ?? null

      setSnippets((current) => current.filter((snippet) => snippet.id !== id))

      const current = editorRef.current

      if (current && current.id === id) {
        if (neighbour) {
          serialRef.current += 1
          openEditor({
            serial: serialRef.current,
            id: neighbour.id,
            draft: draftFromSnippet(neighbour),
          })
        } else {
          openEditor(null)
        }

        setStatus('idle')
      }

      return true
    },
    [openEditor, snippets],
  )

  const activeSnippet = useMemo(() => {
    if (!editor?.id) {
      return null
    }

    return snippets.find((snippet) => snippet.id === editor.id) ?? null
  }, [editor, snippets])

  return {
    snippets,
    activeSnippet,
    draft: editor?.draft ?? EMPTY_SNIPPET_DRAFT,
    /** Changes when a different snippet (or a fresh draft) is opened. */
    editorKey: editor?.serial ?? 0,
    isEditing: editor !== null,
    status,
    errorSummary: storageErrorSummary(errorKind),
    isLoading,
    startCreate,
    selectSnippet,
    changeDraft,
    deleteSnippet,
    archiveSnippet,
  }
}
