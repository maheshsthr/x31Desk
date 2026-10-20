import { Search, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { SnippetListItem } from '@/components/snippets/SnippetListItem'
import { IconButton } from '@/components/ui/IconButton'
import { Select } from '@/components/ui/Select'
import { Surface } from '@/components/ui/Surface'
import type { Snippet } from '@/types/snippet'
import { cn } from '@/utils/cn'
import { SNIPPET_LANGUAGES, type LanguageFilter } from '@/utils/snippet'

type SnippetListProps = {
  /** Snippets after the language filter and the search. */
  snippets: readonly Snippet[]
  /** Total number of stored snippets, to tell "no matches" from "no snippets". */
  totalCount: number
  language: LanguageFilter
  onLanguageChange: (language: LanguageFilter) => void
  query: string
  onQueryChange: (query: string) => void
  activeId: string | null
  onSelect: (id: string) => void
  /** Fills the pane when nothing is visible — no snippets, or no matches. */
  empty: ReactNode
  className?: string
}

/** `all` leads the filter, since it is the widest choice. */
const LANGUAGE_OPTIONS: readonly { value: LanguageFilter; label: string }[] = [
  { value: 'all', label: 'All languages' },
  ...SNIPPET_LANGUAGES,
]

/**
 * The left pane of the snippets workspace: a search field, a language filter and
 * the list. It scrolls on its own so the editor beside it keeps a stable height.
 */
export function SnippetList({
  snippets,
  totalCount,
  language,
  onLanguageChange,
  query,
  onQueryChange,
  activeId,
  onSelect,
  empty,
  className,
}: SnippetListProps) {
  const isFiltering = query.trim() !== '' || language !== 'all'
  const noun = totalCount === 1 ? 'snippet' : 'snippets'
  const countLabel = isFiltering
    ? `${snippets.length} of ${totalCount} ${noun}`
    : `${totalCount} ${noun}`

  return (
    <Surface className={cn('flex min-h-0 flex-col', className)}>
      {totalCount > 0 ? (
        <div className="shrink-0 border-b border-line p-3">
          <div className="relative">
            <Search
              aria-hidden
              strokeWidth={1.9}
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="text"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search snippets"
              aria-label="Search snippets"
              className="h-8 w-full rounded-sm border border-line bg-surface pr-8 pl-8 text-sm text-ink transition-colors duration-150 ease-standard placeholder:text-ink-muted hover:border-accent/40"
            />
            {query !== '' ? (
              <IconButton
                icon={X}
                label="Clear search"
                onClick={() => onQueryChange('')}
                className="absolute top-1/2 right-1 size-6 -translate-y-1/2"
              />
            ) : null}
          </div>

          <div className="mt-2 flex items-center gap-3">
            <Select
              label="Filter by language"
              options={LANGUAGE_OPTIONS}
              value={language}
              onChange={onLanguageChange}
              className="w-40 shrink-0"
            />
            <p className="min-w-0 flex-1 truncate text-2xs text-ink-muted">{countLabel}</p>
          </div>
        </div>
      ) : null}

      {snippets.length === 0 ? (
        empty
      ) : (
        <ul aria-label="Snippets" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
          {snippets.map((snippet) => (
            <SnippetListItem
              key={snippet.id}
              snippet={snippet}
              isActive={snippet.id === activeId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </Surface>
  )
}
