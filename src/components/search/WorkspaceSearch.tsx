import { Search, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { SearchResultsList } from '@/components/search/SearchResultsList'
import { Kbd } from '@/components/ui/Kbd'
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut'
import { useWorkspaceSearch } from '@/hooks/useWorkspaceSearch'
import { requestIntent } from '@/navigation/intent'
import { formatBinding, shortcutById } from '@/shortcuts/shortcuts'
import type { SearchResult } from '@/types/search'
import type { ViewId } from '@/types/navigation'
import { buildSearchResults } from '@/utils/search'

type WorkspaceSearchProps = {
  /** Opens the workspace the chosen result belongs to. */
  onNavigate: (view: ViewId) => void
}

/**
 * Workspace-wide search, anchored in the top bar.
 *
 * Typing filters a snapshot of every collection — notes, tasks, snippets and the
 * archive — and the matches appear in a dropdown directly below the field.
 * Choosing one records an intent and then navigates, so the destination opens
 * the exact record rather than merely switching to its workspace.
 *
 * The top bar is always mounted, which makes it the one place that can see the
 * whole workspace; the snapshot is re-read each time the field is focused so it
 * never lags far behind the pages the user has been editing.
 */
export function WorkspaceSearch({ onNavigate }: WorkspaceSearchProps) {
  const { documents, isLoading, refresh } = useWorkspaceSearch()

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const generatedId = useId()
  const listboxId = `${generatedId}-listbox`
  const optionId = (index: number) => `${generatedId}-option-${index}`

  const results = useMemo(() => buildSearchResults(documents, query), [documents, query])

  // The rendered highlight is clamped to the results that actually exist, so a
  // refresh that shortens the list can never leave it pointing past the end.
  const activeResultIndex =
    results.flat.length === 0 ? 0 : Math.min(activeIndex, results.flat.length - 1)

  const openSearch = () => {
    setOpen(true)
    // Re-read on open: a note edited a moment ago may still be settling.
    void refresh()
  }

  /**
   * Focuses the field and re-opens the dropdown. A modal `<dialog>` renders in
   * the top layer and traps focus, so reaching past one would do nothing
   * visible — the shortcut stands down while a dialog is open.
   */
  const focusSearch = () => {
    if (document.querySelector('dialog[open]') !== null) {
      return
    }

    inputRef.current?.focus()
    inputRef.current?.select()
    openSearch()
  }

  const select = (result: SearchResult) => {
    let target: ViewId

    switch (result.kind) {
      case 'note':
        requestIntent({ type: 'open-note', id: result.id })
        target = 'notes'
        break
      case 'task':
        requestIntent({ type: 'open-task', id: result.id })
        target = 'tasks'
        break
      case 'snippet':
        requestIntent({ type: 'open-snippet', id: result.id })
        target = 'snippets'
        break
      case 'archive':
        // The archive has no per-record pane, so reveal the item by searching
        // for it there instead of opening a detail view that does not exist.
        requestIntent({ type: 'search-archive', query: result.title })
        target = 'archive'
        break
    }

    setOpen(false)
    setQuery('')
    setActiveIndex(0)
    inputRef.current?.blur()
    onNavigate(target)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        setOpen(false)
      }
      return
    }

    if (!open) {
      return
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (results.flat.length > 0) {
          setActiveIndex((current) => Math.min(current + 1, results.flat.length - 1))
        }
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((current) => Math.max(current - 1, 0))
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(Math.max(0, results.flat.length - 1))
        break
      case 'Enter': {
        const result = results.flat[activeResultIndex]

        if (result) {
          event.preventDefault()
          select(result)
        }
        break
      }
      case 'Tab':
        setOpen(false)
        break
      default:
        break
    }
  }

  // Keep the highlighted row visible as the arrow keys walk the list.
  useEffect(() => {
    if (!open) {
      return
    }

    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeResultIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeResultIndex, open])

  // Clicking anywhere outside the field and its dropdown dismisses it.
  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)

    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [open])

  useKeyboardShortcut('k', { ctrlOrMeta: true }, focusSearch)

  // `/` is the other conventional way into a search field. It stands down while
  // the user is typing (see `ignoreWhileTyping`) so the slash reaches the field
  // it was aimed at instead of being swallowed by the shortcut.
  useKeyboardShortcut('/', { ignoreWhileTyping: true }, focusSearch)

  return (
    <div ref={rootRef} className="relative hidden sm:block">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-muted"
        strokeWidth={2}
      />

      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Search workspace"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && results.flat[activeResultIndex] ? optionId(activeResultIndex) : undefined
        }
        placeholder="Search workspace"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          // A new query means a new list, so the highlight returns to the top.
          setActiveIndex(0)
        }}
        onFocus={openSearch}
        onKeyDown={handleKeyDown}
        className="h-8 w-64 rounded-sm border border-line bg-canvas pr-14 pl-8 text-xs text-ink transition-colors duration-150 ease-standard placeholder:text-ink-muted hover:border-accent/40 focus:border-accent"
      />

      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center">
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('')
              setActiveIndex(0)
              inputRef.current?.focus()
            }}
            className="flex size-5 items-center justify-center rounded-xs text-ink-muted transition-colors duration-150 ease-standard hover:bg-nav-hover hover:text-ink"
          >
            <X aria-hidden className="size-3.5" strokeWidth={2} />
          </button>
        ) : (
          // The modifier binding is the hint shown here; `/` is the bare-key
          // alternative, listed with the same entry in Settings.
          <Kbd>{formatBinding(shortcutById('search').bindings[0])}</Kbd>
        )}
      </div>

      {open ? (
        <div className="absolute right-0 z-50 mt-1.5 w-[26rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-line bg-surface shadow-floating">
          <SearchResultsList
            query={query}
            results={results}
            isLoading={isLoading}
            activeIndex={activeResultIndex}
            listboxId={listboxId}
            optionId={optionId}
            listRef={listRef}
            onActiveChange={setActiveIndex}
            onSelect={select}
          />
        </div>
      ) : null}
    </div>
  )
}
