import { ChevronRight, Settings } from 'lucide-react'

import { WorkspaceSearch } from '@/components/search/WorkspaceSearch'
import { IconButton } from '@/components/ui/IconButton'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useTheme } from '@/hooks/useTheme'
import type { ViewId } from '@/types/navigation'
import { cn } from '@/utils/cn'

type TopBarProps = {
  /** Label of the active view, shown as the last breadcrumb segment. */
  title: string
  /** Opens the view a search result belongs to. */
  onNavigate: (view: ViewId) => void
  onOpenSettings: () => void
  className?: string
}

/**
 * Compact application bar spanning the content column: breadcrumb on the left,
 * tooling on the right. Kept to a single 48px row so it never competes with the
 * page content.
 *
 * The theme toggle reads the shared settings store directly, so it and the
 * Settings page can never show different states. Workspace search lives here
 * because the bar outlives every page, so it is the one control that can always
 * see the whole workspace.
 */
export function TopBar({ title, onNavigate, onOpenSettings, className }: TopBarProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <header
      className={cn(
        'flex h-topbar shrink-0 items-center gap-3 border-b border-line bg-surface px-4',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-2xs font-medium tracking-wide text-ink-muted uppercase">
          Workspace
        </span>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-ink-muted/70" strokeWidth={2} />
        <span className="truncate text-sm font-semibold text-ink">{title}</span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <WorkspaceSearch onNavigate={onNavigate} />

        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <IconButton icon={Settings} label="Open settings" onClick={onOpenSettings} />
      </div>
    </header>
  )
}
