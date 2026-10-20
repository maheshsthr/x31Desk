import { Search, X } from 'lucide-react'

import { IconButton } from '@/components/ui/IconButton'
import { cn } from '@/utils/cn'
import { TASK_VIEWS, type TaskView } from '@/utils/task'

type TaskFiltersProps = {
  view: TaskView
  onViewChange: (view: TaskView) => void
  query: string
  onQueryChange: (query: string) => void
  /** Rows currently shown, after the view and the search. */
  visibleCount: number
  /** Rows in the active view before the search narrowed them. */
  viewCount: number
  className?: string
}

/**
 * The filter bar: view tabs, the count they add up to, and a title search.
 *
 * The tabs are a single-select toggle group rather than ARIA tabs — they filter
 * the list beside them in place, so there is no tab panel to move focus into.
 */
export function TaskFilters({
  view,
  onViewChange,
  query,
  onQueryChange,
  visibleCount,
  viewCount,
  className,
}: TaskFiltersProps) {
  const isFiltering = query.trim() !== ''
  const noun = viewCount === 1 ? 'task' : 'tasks'

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="flex items-center gap-3">
        <div
          role="group"
          aria-label="Filter tasks"
          className="flex items-center gap-0.5 rounded-sm border border-line bg-surface p-0.5"
        >
          {TASK_VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option.id === view}
              onClick={() => onViewChange(option.id)}
              className={cn(
                'h-7 rounded-xs px-2.5 text-xs font-medium transition-colors duration-150 ease-standard',
                option.id === view
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-muted hover:bg-canvas hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className="text-2xs text-ink-muted">
          {isFiltering ? `${visibleCount} of ${viewCount} ${noun}` : `${viewCount} ${noun}`}
        </p>
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
          placeholder="Search tasks"
          aria-label="Search tasks"
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
