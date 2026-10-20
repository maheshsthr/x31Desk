import { Search, X } from 'lucide-react'

import { IconButton } from '@/components/ui/IconButton'
import type { ArchiveFilter } from '@/types/archive'
import { cn } from '@/utils/cn'
import { ARCHIVE_FILTERS } from '@/utils/archive'

type ArchiveFiltersProps = {
  filter: ArchiveFilter
  onFilterChange: (filter: ArchiveFilter) => void
  query: string
  onQueryChange: (query: string) => void
  /** How many records fall under each filter, keyed by filter id. */
  counts: Record<ArchiveFilter, number>
  className?: string
}

/**
 * The archive toolbar: kind tabs with their counts, and a title/content search.
 *
 * Like the tasks filter, the tabs are a single-select toggle group rather than
 * ARIA tabs — they narrow the list beside them in place, so there is no panel
 * to move focus into. Each tab prints its own count, which is the quickest way
 * to see what is sitting in the archive.
 */
export function ArchiveFilters({
  filter,
  onFilterChange,
  query,
  onQueryChange,
  counts,
  className,
}: ArchiveFiltersProps) {
  const isFiltering = query.trim() !== ''

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <div
        role="group"
        aria-label="Filter archived items"
        className="flex flex-wrap items-center gap-0.5 rounded-sm border border-line bg-surface p-0.5"
      >
        {ARCHIVE_FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === filter}
            aria-label={`${option.label} (${counts[option.id]})`}
            onClick={() => onFilterChange(option.id)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-xs px-2.5 text-xs font-medium transition-colors duration-150 ease-standard',
              option.id === filter
                ? 'bg-accent-soft text-accent'
                : 'text-ink-muted hover:bg-canvas hover:text-ink',
            )}
          >
            {option.label}
            <span className="text-2xs tabular-nums opacity-70">{counts[option.id]}</span>
          </button>
        ))}
      </div>

      <div className="relative w-full sm:w-56">
        <Search
          aria-hidden
          strokeWidth={1.9}
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-muted"
        />
        <input
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search archive"
          aria-label="Search archive"
          className="h-8 w-full rounded-sm border border-line bg-surface pr-8 pl-8 text-sm text-ink transition-colors duration-150 ease-standard placeholder:text-ink-muted hover:border-accent/40"
        />
        {isFiltering ? (
          <IconButton
            icon={X}
            label="Clear search"
            onClick={() => onQueryChange('')}
            className="absolute top-1/2 right-1 size-6 -translate-y-1/2"
          />
        ) : null}
      </div>
    </div>
  )
}
