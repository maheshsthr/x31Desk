import type { ReactNode } from 'react'

import { ArchiveListItem } from '@/components/archive/ArchiveListItem'
import { Surface } from '@/components/ui/Surface'
import { archiveKey, archivedRecordId, type ArchivedItem } from '@/types/archive'
import { cn } from '@/utils/cn'

type ArchiveListProps = {
  /** Archived records after the filter and search have been applied. */
  items: readonly ArchivedItem[]
  /** Rendered instead of the rows when nothing matches. */
  empty: ReactNode
  onRestore: (item: ArchivedItem) => void
  onDelete: (item: ArchivedItem) => void
  className?: string
}

/**
 * The archive surface: a scrolling column of rows, or the empty state for the
 * filter that produced none. Scrolls on its own so the toolbar above it stays
 * put.
 */
export function ArchiveList({
  items,
  empty,
  onRestore,
  onDelete,
  className,
}: ArchiveListProps) {
  return (
    <Surface className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {items.length === 0 ? (
        empty
      ) : (
        <ul aria-label="Archived items" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
          {items.map((item) => (
            <ArchiveListItem
              key={archiveKey(item.type, archivedRecordId(item))}
              item={item}
              onRestore={onRestore}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </Surface>
  )
}
