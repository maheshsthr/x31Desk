import { FileText, NotebookPen, SquarePen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { NoteEditor } from '@/components/notes/NoteEditor'
import { NotesList } from '@/components/notes/NotesList'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Surface } from '@/components/ui/Surface'
import { getLastStorageErrorKind, storageErrorMessage } from '@/data/storageError'
import { useNotes } from '@/hooks/useNotes'
import { useToast } from '@/hooks/useToast'
import { useViewIntent } from '@/hooks/useViewIntent'
import type { NoteDraft } from '@/types/note'

/**
 * The notes workspace: a searchable list beside the note that is open.
 *
 * All state lives here or in `useNotes`; the list and the editor are presentational
 * and never touch storage.
 */
export function NotesPage() {
  const { notify } = useToast()
  const {
    notes,
    selectedNote,
    status,
    errorSummary,
    isLoading,
    createNote,
    selectNote,
    editNote,
    deleteNote,
    archiveNote,
  } = useNotes()

  const [query, setQuery] = useState('')

  // Bumped after a note is created so the editor can put the caret in the title.
  const [focusToken, setFocusToken] = useState(0)

  /** Title and content are both searched; matching is case-insensitive. */
  const visibleNotes = useMemo(() => {
    const needle = query.trim().toLowerCase()

    if (needle === '') {
      return notes
    }

    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(needle) ||
        note.content.toLowerCase().includes(needle),
    )
  }, [notes, query])

  const handleCreate = useCallback(() => {
    void createNote().then((id) => {
      if (id) {
        setFocusToken((token) => token + 1)
      }
    })
  }, [createNote])

  // A workspace-search result names the note to open. The list loads
  // asynchronously, so the id is held until its note arrives rather than
  // dropped if it is not there on the first pass.
  const pendingNoteId = useRef<string | null>(null)

  // "New note" on the dashboard arrives here with an intent attached, so the
  // shortcut creates a note instead of merely opening the workspace. A search
  // result arrives the same way, asking for one specific note instead — whether
  // the user is arriving from another view or already sitting in this one.
  useViewIntent((intent) => {
    if (intent.type === 'create-note') {
      handleCreate()
      return true
    }

    if (intent.type === 'open-note') {
      // Already loaded (searching from inside the workspace): open it now.
      // Otherwise hold the id until the list arrives.
      if (notes.some((note) => note.id === intent.id)) {
        selectNote(intent.id)
      } else {
        pendingNoteId.current = intent.id
      }
      return true
    }

    return false
  })

  useEffect(() => {
    const id = pendingNoteId.current

    if (id === null || !notes.some((note) => note.id === id)) {
      return
    }

    pendingNoteId.current = null
    selectNote(id)
  }, [notes, selectNote])

  const handleChange = (draft: NoteDraft) => {
    if (selectedNote) {
      editNote(selectedNote.id, draft)
    }
  }

  const handleDelete = (id: string) => {
    void deleteNote(id).then((deleted) => {
      notify(
        deleted
          ? 'Note deleted.'
          : storageErrorMessage(getLastStorageErrorKind(), 'That note could not be deleted.'),
      )
    })
  }

  const handleArchive = (id: string) => {
    void archiveNote(id).then((archived) => {
      notify(
        archived
          ? 'Note archived.'
          : storageErrorMessage(getLastStorageErrorKind(), 'That note could not be archived.'),
      )
    })
  }

  return (
    <>
      <PageHeader
        title="Notes"
        description="Long-form notes and quick captures, written and searched entirely on this device."
        actions={
          <Button variant="primary" icon={SquarePen} onClick={handleCreate}>
            New note
          </Button>
        }
      />

      {isLoading ? (
        <p className="mt-5 text-sm text-ink-muted">Loading notes…</p>
      ) : notes.length === 0 ? (
        <EmptyState
          className="mt-5 flex-1 justify-center"
          icon={NotebookPen}
          title="No notes yet"
          description="Create your first note — it is saved on this device automatically as you write."
          action={
            <Button variant="primary" icon={SquarePen} onClick={handleCreate}>
              New note
            </Button>
          }
        />
      ) : (
        <div className="mt-5 flex min-h-[26rem] flex-1 flex-col gap-4 lg:flex-row">
          <NotesList
            className="flex-1 lg:w-75 lg:flex-none"
            notes={visibleNotes}
            totalCount={notes.length}
            query={query}
            onQueryChange={setQuery}
            selectedId={selectedNote?.id ?? null}
            onSelect={selectNote}
          />

          {selectedNote ? (
            <NoteEditor
              note={selectedNote}
              status={status}
              errorSummary={errorSummary}
              focusToken={focusToken}
              onChange={handleChange}
              onArchive={() => handleArchive(selectedNote.id)}
              onDelete={() => handleDelete(selectedNote.id)}
            />
          ) : (
            <Surface className="flex min-h-0 flex-1 items-center justify-center p-4">
              <EmptyState
                variant="inline"
                icon={FileText}
                title="No note selected"
                description="Choose a note from the list, or create a new one."
              />
            </Surface>
          )}
        </div>
      )}
    </>
  )
}
