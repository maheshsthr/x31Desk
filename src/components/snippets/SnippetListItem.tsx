import { CopyButton } from '@/components/snippets/CopyButton'
import { SnippetLanguageBadge } from '@/components/snippets/SnippetLanguageBadge'
import type { Snippet } from '@/types/snippet'
import { cn } from '@/utils/cn'
import { formatShortDate } from '@/utils/date'
import { codePreview } from '@/utils/snippet'

type SnippetListItemProps = {
  snippet: Snippet
  isActive: boolean
  onSelect: (id: string) => void
}

/** Tags a row shows before the rest are left to the editor. */
const VISIBLE_TAGS = 2

/**
 * One row: the snippet's title, a one-line preview of its code and its meta.
 *
 * The copy button is a sibling of the content button rather than inside it —
 * interactive controls may not nest, and separating them keeps the accessible
 * name of each one meaningful.
 */
export function SnippetListItem({ snippet, isActive, onSelect }: SnippetListItemProps) {
  const title = snippet.title.trim() || 'Untitled snippet'
  const preview = codePreview(snippet.code)
  const tags = snippet.tags.slice(0, VISIBLE_TAGS)

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-sm transition-colors duration-150 ease-standard',
          isActive ? 'bg-accent-soft' : 'hover:bg-canvas',
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(snippet.id)}
          aria-current={isActive ? 'true' : undefined}
          className="min-w-0 flex-1 rounded-xs px-2.5 py-2 text-left"
        >
          <span
            className={cn('block truncate text-sm font-medium', isActive ? 'text-accent' : 'text-ink')}
          >
            {title}
          </span>

          {preview ? (
            <span className="mt-0.5 block truncate font-mono text-2xs text-ink-muted">
              {preview}
            </span>
          ) : null}

          <span className="mt-1 flex items-center gap-1.5 overflow-hidden">
            <SnippetLanguageBadge language={snippet.language} />
            {tags.map((tag) => (
              <span key={tag} className="min-w-0 truncate text-2xs text-ink-muted">
                #{tag}
              </span>
            ))}
            <span className="ml-auto shrink-0 text-2xs text-ink-muted">
              {formatShortDate(snippet.updatedAt)}
            </span>
          </span>
        </button>

        <CopyButton
          text={snippet.code}
          label={`Copy ${title}`}
          iconOnly
          className="mr-1.5 shrink-0 opacity-0 transition-opacity duration-150 ease-standard group-hover:opacity-100 group-focus-within:opacity-100"
        />
      </div>
    </li>
  )
}
