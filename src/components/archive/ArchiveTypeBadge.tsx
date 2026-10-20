import { Code, NotebookPen, SquareCheckBig } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { ArchiveItemType } from '@/types/archive'
import { cn } from '@/utils/cn'
import { ARCHIVE_TYPE_LABELS } from '@/utils/archive'

type ArchiveTypeBadgeProps = {
  type: ArchiveItemType
  className?: string
}

/**
 * The icon that stands for each workspace, matching the sidebar so an archived
 * row is recognisable at a glance.
 */
const TYPE_ICONS: Record<ArchiveItemType, LucideIcon> = {
  note: NotebookPen,
  task: SquareCheckBig,
  snippet: Code,
}

/**
 * Compact chip naming the workspace an archived record came from.
 *
 * The type is spelled out rather than only icon-coded, so the archive is
 * readable without relying on recognising a glyph.
 */
export function ArchiveTypeBadge({ type, className }: ArchiveTypeBadgeProps) {
  const Icon = TYPE_ICONS[type]

  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-xs border border-line bg-canvas px-1.5 text-2xs font-medium text-ink-muted',
        className,
      )}
    >
      <Icon aria-hidden className="size-3 shrink-0" strokeWidth={2} />
      {ARCHIVE_TYPE_LABELS[type]}
    </span>
  )
}
