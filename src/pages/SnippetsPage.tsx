import { FileCode, Plus, SearchX, SquareCode } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { SnippetEditor } from '@/components/snippets/SnippetEditor'
import { SnippetList } from '@/components/snippets/SnippetList'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Surface } from '@/components/ui/Surface'
import { getLastStorageErrorKind, storageErrorMessage } from '@/data/storageError'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut'
import { useSnippets } from '@/hooks/useSnippets'
import { useToast } from '@/hooks/useToast'
import { useViewIntent } from '@/hooks/useViewIntent'
import { selectSnippets, type LanguageFilter } from '@/utils/snippet'

/**
 * The snippets workspace: a searchable, filtered list beside the snippet that
 * is open, with edits autosaved as they are typed.
 *
 * All state lives here or in `useSnippets`; the list and the editor are
 * presentational and never touch storage.
 */
export function SnippetsPage() {
  const { notify } = useToast()
  const { copy } = useCopyToClipboard()
  const {
    snippets,
    activeSnippet,
    draft,
    editorKey,
    isEditing,
    status,
    errorSummary,
    isLoading,
    startCreate,
    selectSnippet,
    changeDraft,
    deleteSnippet,
    archiveSnippet,
  } = useSnippets()

  const [language, setLanguage] = useState<LanguageFilter>('all')
  const [query, setQuery] = useState('')

  // A workspace-search result names the snippet to open. The list loads
  // asynchronously, so the id is held until its snippet arrives.
  const pendingSnippetId = useRef<string | null>(null)

  useViewIntent((intent) => {
    // "New snippet" arrives from the shell's `Ctrl+N` — from this workspace or
    // as a cross-view request — and starts a blank draft through the same path
    // the page's own button uses (`startCreate` flushes the open draft first,
    // so nothing in progress is lost).
    if (intent.type === 'create-snippet') {
      startCreate()
      return true
    }

    if (intent.type !== 'open-snippet') {
      return false
    }

    // Already loaded (searching from inside the workspace): open it now.
    // Otherwise hold the id until the list arrives.
    if (snippets.some((snippet) => snippet.id === intent.id)) {
      selectSnippet(intent.id)
    } else {
      pendingSnippetId.current = intent.id
    }

    return true
  })

  useEffect(() => {
    const id = pendingSnippetId.current

    if (id === null || !snippets.some((snippet) => snippet.id === id)) {
      return
    }

    pendingSnippetId.current = null
    selectSnippet(id)
  }, [snippets, selectSnippet])

  const visibleSnippets = useMemo(
    () => selectSnippets(snippets, language, query),
    [snippets, language, query],
  )

  const handleDelete = useCallback(() => {
    if (!activeSnippet) {
      return
    }

    void deleteSnippet(activeSnippet.id).then((deleted) => {
      notify(
        deleted
          ? 'Snippet deleted.'
          : storageErrorMessage(getLastStorageErrorKind(), 'That snippet could not be deleted.'),
      )
    })
  }, [activeSnippet, deleteSnippet, notify])

  const handleArchive = useCallback(() => {
    if (!activeSnippet) {
      return
    }

    void archiveSnippet(activeSnippet.id).then((archived) => {
      notify(
        archived
          ? 'Snippet archived.'
          : storageErrorMessage(getLastStorageErrorKind(), 'That snippet could not be archived.'),
      )
    })
  }, [activeSnippet, archiveSnippet, notify])

  // Copies the open snippet without leaving the keyboard. Registered only while
  // there is code to copy, so it never swallows the shortcut elsewhere.
  useKeyboardShortcut(
    'c',
    { ctrlOrMeta: true, shift: true, enabled: isEditing && draft.code !== '' },
    () => {
      void copy(draft.code)
    },
  )

  const showPageEmptyState = !isLoading && snippets.length === 0 && !isEditing

  return (
    <>
      <PageHeader
        title="Snippets"
        description="Reusable pieces of code, stored on this device and searchable by title, tag or language."
        actions={
          <Button variant="primary" icon={Plus} onClick={startCreate}>
            New snippet
          </Button>
        }
      />

      {isLoading ? (
        <p className="mt-5 text-sm text-ink-muted">Loading snippets…</p>
      ) : showPageEmptyState ? (
        <EmptyState
          className="mt-5 flex-1 justify-center"
          icon={SquareCode}
          title="No snippets yet"
          description="Save a snippet once and copy it whenever you need it. It stays on this device."
          action={
            <Button variant="primary" icon={Plus} onClick={startCreate}>
              New snippet
            </Button>
          }
        />
      ) : (
        <div className="mt-5 flex min-h-[26rem] flex-1 flex-col gap-4 lg:flex-row">
          <SnippetList
            className="flex-1 lg:w-80 lg:flex-none"
            snippets={visibleSnippets}
            totalCount={snippets.length}
            language={language}
            onLanguageChange={setLanguage}
            query={query}
            onQueryChange={setQuery}
            activeId={activeSnippet?.id ?? null}
            onSelect={selectSnippet}
            empty={
              snippets.length === 0 ? (
                <EmptyState
                  variant="inline"
                  icon={SquareCode}
                  title="No snippets yet"
                  description="Give a snippet a title and some code and it will be saved here."
                />
              ) : (
                <EmptyState
                  variant="inline"
                  icon={SearchX}
                  title="No matching snippets"
                  description="Try a different word, tag or language."
                />
              )
            }
          />

          {isEditing ? (
            <SnippetEditor
              key={editorKey}
              snippet={activeSnippet}
              draft={draft}
              status={status}
              errorSummary={errorSummary}
              onChange={changeDraft}
              onArchive={handleArchive}
              onDelete={handleDelete}
            />
          ) : (
            <Surface className="flex min-h-0 flex-1 flex-col">
              <EmptyState
                variant="inline"
                icon={FileCode}
                title="No snippet selected"
                description="Choose a snippet from the list, or create a new one."
              />
            </Surface>
          )}
        </div>
      )}
    </>
  )
}
