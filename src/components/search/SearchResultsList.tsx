import { Archive, Code, FileText, Search, SearchX, SquareCheckBig } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { RefObject } from 'react'

import type { SearchResult, SearchResultKind, SearchResults } from '@/types/search'
import { cn } from '@/utils/cn'
import { truncate } from '@/utils/text'

/** A recognisable glyph per section, so a result reads at a glance. */
const KIND_ICONS: Record<SearchResultKind, LucideIcon> = {
  note: FileText,
  task: SquareCheckBig,
  snippet: Code,
  archive: Archive,
}

type SearchResultsListProps = {
  query: string
  results: SearchResults
  isLoading: boolean
  activeIndex: number
  /** Id of the listbox, referenced by the input's `aria-controls`. */
  listboxId: string
  /** Builds the id of the option at a given flat index. */
  optionId: (index: number) => string
  listRef: RefObject<HTMLDivElement | null>
  onActiveChange: (index: number) => void
  onSelect: (result: SearchResult) => void
}

/**
 * The body of the workspace-search dropdown: the grouped matches, with a hint
 * while the query is empty and a plain answer when nothing matches.
 *
 * The listbox element is always rendered so the field's `aria-controls` never
 * points at nothing; the hint and the empty state live beside it in a
 * `role="status"` region, which is also what announces "no matches" as the user
 * types. The flat order it renders is the order the input's arrow keys walk, so
 * keyboard and pointer always agree on what is highlighted.
 */
export function SearchResultsList({
  query,
  results,
  isLoading,
  activeIndex,
  listboxId,
  optionId,
  listRef,
  onActiveChange,
  onSelect,
}: SearchResultsListProps) {
  const trimmed = query.trim()
  const hasResults = results.flat.length > 0
  const hiddenCount = results.total - results.flat.length

  return (
    <>
      {hasResults ? null : trimmed === '' ? (
        <div role="status" className="flex items-center gap-2.5 px-3 py-3 text-xs text-ink-muted">
          <Search aria-hidden className="size-4 shrink-0" strokeWidth={2} />
          <span>Search notes, tasks, snippets and the archive as you type.</span>
        </div>
      ) : (
        <div role="status" className="flex flex-col items-center gap-1 px-4 py-6 text-center">
          <SearchX aria-hidden className="mb-1 size-5 text-ink-muted" strokeWidth={1.75} />
          <p className="text-sm font-medium text-ink">
            {isLoading ? 'Searching…' : `No matches for “${truncate(trimmed, 40)}”`}
          </p>
          <p className="text-xs text-ink-muted">
            {isLoading ? 'Reading the workspace.' : 'Try a different word, tag or language.'}
          </p>
        </div>
      )}

      <div
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label="Search results"
        className={cn(hasResults && 'max-h-[22rem] overflow-y-auto p-1')}
      >
        {hasResults ? (
          <>
            {results.groups.map((group) => (
              <div key={group.kind} role="group" aria-label={group.label}>
                <p
                  aria-hidden
                  className="px-2.5 pt-2 pb-1 text-2xs font-semibold tracking-wide text-ink-muted uppercase"
                >
                  {group.label}
                </p>

                {group.entries.map(({ result, index }) => {
                  const Icon = KIND_ICONS[result.kind]
                  const isActive = index === activeIndex

                  return (
                    <div
                      key={`${result.kind}:${result.id}`}
                      id={optionId(index)}
                      role="option"
                      aria-selected={isActive}
                      data-index={index}
                      className={cn(
                        'flex cursor-pointer flex-col gap-0.5 rounded-sm px-2.5 py-1.5',
                        isActive ? 'bg-accent-soft' : 'hover:bg-nav-hover',
                      )}
                      onMouseMove={() => onActiveChange(index)}
                      onClick={() => onSelect(result)}
                    >
                      <span className="flex items-center gap-2">
                        <Icon
                          aria-hidden
                          className={cn(
                            'size-3.5 shrink-0',
                            isActive ? 'text-accent' : 'text-ink-muted',
                          )}
                          strokeWidth={2}
                        />
                        <span className="truncate text-sm font-medium text-ink">{result.title}</span>
                        {result.meta ? (
                          <span className="ml-auto shrink-0 rounded-xs border border-line px-1.5 py-0.5 text-2xs text-ink-muted">
                            {result.meta}
                          </span>
                        ) : null}
                      </span>

                      {result.preview ? (
                        <span className="truncate pl-[1.375rem] text-xs text-ink-muted">
                          {result.preview}
                        </span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ))}

            {hiddenCount > 0 ? (
              <p className="px-2.5 py-2 text-center text-2xs text-ink-muted">
                {hiddenCount} more {hiddenCount === 1 ? 'match' : 'matches'} — keep typing to narrow
                it down.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  )
}
