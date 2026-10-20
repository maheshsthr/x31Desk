import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { TitleBar } from '@/components/titlebar/TitleBar'
import { useShellShortcuts } from '@/hooks/useShellShortcuts'
import { getNavEntry } from '@/navigation/navigation'
import { VIEW_COMPONENTS } from '@/navigation/viewRegistry'
import type { ViewId } from '@/types/navigation'

type AppShellProps = {
  activeView: ViewId
  onNavigate: (view: ViewId) => void
}

/**
 * The application shell: the title bar across the top, then the sidebar on the
 * left and the top bar plus scrollable content column on the right.
 *
 * The title bar comes first because it spans the whole window — it is the
 * window's chrome, not part of the workspace — and because its menus drive the
 * same navigation and actions the rest of the shell does. It owns no state:
 * the menus carry shell actions that `performShellAction` runs, exactly as the
 * keyboard layer does.
 *
 * The shell itself never unmounts while navigating — only the component in the
 * content area is swapped — so window-level concerns (notifications, search
 * shortcuts) stay alive across views. The theme is read where it is used (the
 * title bar, the top bar and Settings), not passed through here.
 */
export function AppShell({ activeView, onNavigate }: AppShellProps) {
  const activeEntry = getNavEntry(activeView)
  const ActivePage = VIEW_COMPONENTS[activeView]

  // Every shell-owned keyboard shortcut — section navigation, create, save,
  // rename and refresh — resolves through this one listener, which is why the
  // layer sits at this level: the shell is the one component that always knows
  // both the active view and how to change it. `Ctrl+K` and `/` stay with the
  // search field they focus, and `Esc` stays with the dialogs and toasts that
  // close, so no keystroke has two handlers.
  useShellShortcuts({ activeView, onNavigate })

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
      <TitleBar onNavigate={onNavigate} />

      <div className="flex min-h-0 flex-1">
        <Sidebar activeView={activeView} onNavigate={onNavigate} />

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            title={activeEntry.label}
            onNavigate={onNavigate}
            onOpenSettings={() => onNavigate('settings')}
          />

          <main id="content" className="min-h-0 flex-1 overflow-y-auto">
            {/*
              A full-height flex column so a page can opt into filling the
              viewport (the notes workspace does, so its panes scroll internally
              instead of the whole page). Pages that simply stack content are
              unaffected: they keep their natural height.
            */}
            <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-6 py-6">
              <ActivePage onNavigate={onNavigate} />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
