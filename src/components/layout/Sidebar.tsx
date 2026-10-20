import { NavItem } from '@/components/layout/NavItem'
import { PRIMARY_NAV, SECONDARY_NAV } from '@/navigation/navigation'
import { formatBinding, shortcutById } from '@/shortcuts/shortcuts'
import type { ViewId } from '@/types/navigation'

type SidebarProps = {
  activeView: ViewId
  onNavigate: (view: ViewId) => void
}

function navShortcut(id: ViewId): string | undefined {
  try {
    const shortcut = shortcutById(`go-${id}` as `go-${ViewId}`)
    return formatBinding(shortcut.bindings[0])
  } catch {
    return undefined
  }
}

/**
 * Persistent workspace navigation.
 *
 * Two fixed regions: a scrollable navigation region (it only scrolls when the
 * window is shorter than the item list) and the footer with settings plus the
 * local-workspace indicator. The brand header that used to top this column now
 * lives in the title bar, which spans the window, so the logo appears once.
 */
export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  return (
    <aside
      aria-label="Workspace navigation"
      className="flex w-sidebar shrink-0 flex-col border-r border-line bg-sidebar"
    >
      <nav
        aria-label="Workspace sections"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2"
      >
        <p className="px-2 pt-1 pb-1 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
          Workspace
        </p>

        {PRIMARY_NAV.map((entry) => {
          const shortcut = navShortcut(entry.id)
          return (
            <NavItem
              key={entry.id}
              icon={entry.icon}
              label={entry.label}
              isActive={entry.id === activeView}
              onSelect={() => onNavigate(entry.id)}
              shortcut={shortcut}
              title={shortcut ? `${entry.label} (${shortcut})` : entry.label}
            />
          )
        })}
      </nav>

      <div className="shrink-0 p-2">
        {SECONDARY_NAV.map((entry) => {
          const shortcut = navShortcut(entry.id)
          return (
            <NavItem
              key={entry.id}
              icon={entry.icon}
              label={entry.label}
              isActive={entry.id === activeView}
              onSelect={() => onNavigate(entry.id)}
              shortcut={shortcut}
              title={shortcut ? `${entry.label} (${shortcut})` : entry.label}
            />
          )
        })}
      </div>
    </aside>
  )
}
