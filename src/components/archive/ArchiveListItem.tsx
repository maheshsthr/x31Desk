import { ArchiveRestore, Trash2 } from 'lucide-react'

import { ArchiveTypeBadge } from '@/components/archive/ArchiveTypeBadge'
import { IconButton } from '@/components/ui/IconButton'
import type { ArchivedItem } from '@/types/archive'
import { archivedPreview, archivedTitle } from '@/utils/archive'
import { formatDateTime } from '@/utils/date'

type ArchiveListItemProps = {
  item: ArchivedItem
  onRestore: (item: ArchivedItem) => void
  onDelete: (item: ArchivedItem) => void
}

/**
 * One archived record: its title, the workspace it came from, when it was set
 * aside and a preview of its body, with the two actions beside it.
 *
 * Restore and delete are always visible rather than revealed on hover: they are
 * the entire point of this page, and hiding them would make a short archive
 * look inert.
 */
export function ArchiveListItem({ item, onRestore, onDelete }: ArchiveListItemProps) {
  const title = archivedTitle(item)
  const preview = archivedPreview(item)

  return (
    <li className="group flex items-start gap-3 rounded-sm px-2.5 py-2 transition-colors duration-150 ease-standard hover:bg-canvas focus-within:bg-canvas">
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{title}</span>

        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <ArchiveTypeBadge type={item.type} />
          <span className="text-2xs text-ink-muted">
            Archived {formatDateTime(item.archivedAt)}
          </span>
        </span>

        {preview ? (
          <span
            className={
              item.type === 'snippet'
                ? 'mt-1 block truncate font-mono text-xs text-ink-muted'
                : 'mt-1 block truncate text-xs text-ink-muted'
            }
          >
            {preview}
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          icon={ArchiveRestore}
          label={`Restore “${title}”`}
          onClick={() => onRestore(item)}
          className="hover:bg-accent-soft hover:text-accent"
        />
        <IconButton
          icon={Trash2}
          label={`Delete “${title}” permanently`}
          onClick={() => onDelete(item)}
          className="hover:bg-danger-soft hover:text-danger"
        />
      </div>
    </li>
  )
}
