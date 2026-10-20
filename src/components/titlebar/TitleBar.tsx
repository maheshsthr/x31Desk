import { Copy, Minus, Square, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { BrandMark } from '@/components/branding/BrandMark'
import { TitleBarMenu, type TitleBarMenuEntry } from '@/components/titlebar/TitleBarMenu'
import { installEditableFocusTracking, runEditCommand } from '@/components/titlebar/editCommands'
import {
  TITLE_BAR_MENUS,
  visibleItems,
  type HelpSectionId,
  type TitleBarAction,
} from '@/components/titlebar/titleBarMenus'
import { performShellAction } from '@/hooks/useShellShortcuts'
import { useTheme } from '@/hooks/useTheme'
import { useToast } from '@/hooks/useToast'
import { useWindowControls } from '@/hooks/useWindowControls'
import type { ViewId } from '@/types/navigation'
import { cn } from '@/utils/cn'

type TitleBarProps = {
  /** Opens the view a menu row asks for. */
  onNavigate: (view: ViewId) => void
}

/**
 * The application's own title bar, in place of the Windows caption.
 *
 * The window is frameless, so this row *is* the chrome: the symbol and the app
 * name on the left, the File / Edit / View / Help menus beside them, and the
 * caption buttons on the right. It is deliberately the shortest row in the
 * shell — chrome, not another toolbar — and it sits above the sidebar and the
 * top bar rather than inside the content column, because it spans the window.
 *
 * Behaviour that matters:
 *
 *   * **The bar is a drag region** (`app-region-drag`), so pressing anywhere on
 *     its background moves the window, and the operating system's own
 *     double-click-to-maximize works on that background. The menus, their rows
 *     and the caption buttons opt out with `app-region-no-drag`, so no control
 *     can start a window drag.
 *   * **Menus are the shell's second input, not a second implementation.**
 *     Every shell row (New Note, Save Now, Reload, navigation) carries the same
 *     `ShellShortcutAction` a keystroke resolves to and runs it through
 *     `performShellAction` — choosing "New Task" and pressing `Ctrl+N` in Tasks
 *     are the same call, so the two can never drift.
 *   * **The caption buttons are real window operations**, reached over the
 *     narrow `windowControls` bridge (minimize, maximize/restore, close) and
 *     reflecting the main process's pushed maximize state, so a snap or an
 *     OS-side double-click leaves the glyph correct.
 *   * **In a browser there is no window to control**, so the buttons and the
 *     File → Exit row simply do not render; everything else — menus, editing,
 *     navigation, theme — works exactly as it does on the desktop.
 */
export function TitleBar({ onNavigate }: TitleBarProps) {
  const { notify } = useToast()
  const { toggleTheme } = useTheme()
  const controls = useWindowControls()
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const barRef = useRef<HTMLElement | null>(null)

  // The Edit rows act on the field the user was last typing in, so the bar
  // remembers it for as long as it is mounted.
  useEffect(() => installEditableFocusTracking(), [])

  // While a menu is open: Escape closes it and swallows the key (a toast must
  // not also dismiss, and no dialog can be up because a modal dialog makes the
  // whole bar inert), and a press anywhere outside the bar closes it.
  useEffect(() => {
    if (openMenu === null) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpenMenu(null)
      }
    }

    const onPointerDown = (event: PointerEvent) => {
      const bar = barRef.current
      if (bar !== null && event.target instanceof Node && !bar.contains(event.target)) {
        setOpenMenu(null)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointerdown', onPointerDown, true)

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [openMenu])

  /** Navigates to Settings and brings one of its sections into view. */
  const openSettingsSection = (section: HelpSectionId) => {
    onNavigate('settings')

    // Settings mounts in this same commit, so the section may not exist yet on
    // the first frame; retry briefly rather than scrolling nothing.
    let attempts = 0
    const reveal = () => {
      const target = document.getElementById(section)

      if (target !== null) {
        target.scrollIntoView({ block: 'start' })
        return
      }

      attempts += 1
      if (attempts < 20) {
        requestAnimationFrame(reveal)
      }
    }

    requestAnimationFrame(reveal)
  }

  const activate = (action: TitleBarAction) => {
    setOpenMenu(null)

    switch (action.type) {
      case 'navigate':
      case 'new-item':
      case 'save':
      case 'rename':
      case 'refresh':
        performShellAction(action, { onNavigate, notify })
        break
      case 'toggle-theme':
        toggleTheme()
        break
      case 'edit':
        runEditCommand(action.command)
        break
      case 'help-section':
        openSettingsSection(action.section)
        break
      case 'exit':
        // Reached only in Electron: the row is hidden without the bridge.
        controls?.close()
        break
    }
  }

  const isDesktop = controls !== null

  return (
    <header
      ref={barRef}
      data-title-bar
      className="app-region-drag relative z-30 flex h-[2.125rem] shrink-0 select-none items-center bg-sidebar text-ink"
    >
      <div className="flex h-full min-w-0 items-center">
        <div className="flex items-center gap-1.5 pl-2 pr-1.5">
          {/* `pointer-events-none` so a press on the mark drags the window
              rather than starting a drag of the image itself. */}
          <BrandMark variant="mark" size={16} className="pointer-events-none" />
          <span className="text-[11px] font-normal leading-none tracking-tight whitespace-nowrap text-ink-muted">x31Desk</span>
        </div>

        <nav aria-label="Application menu" className="flex h-full items-center">
          {TITLE_BAR_MENUS.map((menu) => (
            <TitleBarMenu
              key={menu.id}
              menu={menu}
              items={visibleItems(menu, isDesktop)}
              open={openMenu === menu.id}
              onOpen={() => setOpenMenu(menu.id)}
              onClose={() => setOpenMenu(null)}
              onHover={() => {
                if (openMenu !== null) {
                  setOpenMenu(menu.id)
                }
              }}
              onActivate={(entry: TitleBarMenuEntry) => activate(entry.action)}
            />
          ))}
        </nav>
      </div>

      {/* The empty stretch of bar between the menus and the caption buttons
          stays draggable — it is the widest part of the drag region. */}
      <div className="min-w-0 flex-1 self-stretch" />

      {controls !== null && (
        <div className="app-region-no-drag flex h-full" role="group" aria-label="Window controls">
      <WindowButton label="Minimize" control="minimize" data-window-control="minimize" onClick={controls.minimize}>
            <Minus size={12} aria-hidden />
          </WindowButton>
          <WindowButton
            label={controls.maximized ? 'Restore Down' : 'Maximize'}
            control="maximize"
            data-window-control="maximize"
            maximized={controls.maximized}
            onClick={controls.toggleMaximize}
          >
            {controls.maximized ? (
              <Copy size={11} aria-hidden />
            ) : (
              <Square size={10} aria-hidden />
            )}
          </WindowButton>
          <WindowButton label="Close" control="close" data-window-control="close" danger onClick={controls.close}>
            <X size={12} aria-hidden />
          </WindowButton>
        </div>
      )}
    </header>
  )
}

type WindowButtonProps = {
  /** Accessible name; the maximize button's changes with the window state. */
  label: string
  control: 'minimize' | 'maximize' | 'close'
  onClick: () => void
  /** Whether the window is maximized, mirrored onto `data-maximized`. */
  maximized?: boolean
  /** The close button's Windows-style red hover. */
  danger?: boolean
  children: ReactNode
}

/**
 * One caption button.
 *
 * Sized like the Windows caption (a full-height 3rem target) and coloured with
 * the app's own tokens, so the group reads as chrome in both themes. `Close`
 * takes the destructive hover treatment — the one place the palette warns.
 */
function WindowButton({ label, control, onClick, maximized, danger = false, children }: WindowButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-window-control={control}
      data-maximized={maximized === undefined ? undefined : String(maximized)}
      onClick={onClick}
      className={cn(
        'flex h-full w-[46px] items-center justify-center text-ink-muted transition-colors',
        danger
          ? 'hover:bg-danger hover:text-on-danger'
          : 'hover:bg-[#e8eef6] hover:text-ink dark:hover:bg-[#1b2734]',
      )}
    >
      {children}
    </button>
  )
}
