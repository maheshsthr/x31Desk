import { useId } from 'react'

import type { TitleBarItem, TitleBarMenu as MenuDefinition } from '@/components/titlebar/titleBarMenus'
import { cn } from '@/utils/cn'

/** A menu row that carries an action — everything but a separator. */
export type TitleBarMenuEntry = Extract<TitleBarItem, { kind: 'item' }>

type TitleBarMenuProps = {
  menu: MenuDefinition
  /** The rows to render; `desktopOnly` rows are filtered out in a browser. */
  items: readonly TitleBarItem[]
  open: boolean
  onOpen: () => void
  onClose: () => void
  /** Opens this menu when the pointer crosses it while another is open. */
  onHover: () => void
  onActivate: (entry: TitleBarMenuEntry) => void
}

/**
 * One menu in the title bar: a trigger that looks like a caption label and the
 * dropdown it opens.
 *
 * Two details carry the whole menu behaviour:
 *
 *   * **`mousedown` is prevented on the trigger and on every row.** A menu must
 *     not move focus, because the Edit rows act on whatever field the user was
 *     working in — if opening the menu blurred that field, Undo and Copy would
 *     have nothing to act on. Preventing the default keeps focus exactly where
 *     it was, for both mouse and keyboard paths.
 *   * **The dropdown is a plain child of the trigger, not a portal.** The bar
 *     is the topmost row of the shell and never scrolls, so nothing can clip
 *     the dropdown; keeping it in place means it inherits the bar's stacking
 *     context and sits above the page without a z-index arms race.
 *
 * The rows are real `<button role="menuitem">` elements, so they are reachable
 * and operable by keyboard as well as by mouse.
 */
export function TitleBarMenu({
  menu,
  items,
  open,
  onOpen,
  onClose,
  onHover,
  onActivate,
}: TitleBarMenuProps) {
  const menuId = useId()

  return (
    <div className="relative h-full">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-menu-trigger={menu.id}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (open ? onClose() : onOpen())}
        onPointerEnter={onHover}
        className={cn(
          // `no-drag`: the trigger lives inside the bar's drag region, and a
          // press on it must open a menu, not move the window.
          'app-region-no-drag h-full px-2 text-[11px] leading-none text-ink transition-colors',
          open ? 'bg-[#e8eef6] dark:bg-[#1b2734]' : 'hover:bg-[#e8eef6] dark:hover:bg-[#1b2734]',
        )}
      >
        {menu.label}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={menu.label}
          className="app-region-no-drag absolute left-0 top-full z-50 min-w-52 border border-line bg-surface p-1 shadow-floating"
        >
          {items.map((item) =>
            item.kind === 'separator' ? (
              <div key={item.id} role="separator" className="my-1 h-px bg-line" />
            ) : (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                data-menu-item={item.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onActivate(item)}
                className="flex w-full items-center justify-between gap-6 px-2 py-1 text-left text-[11px] leading-tight text-ink transition-colors hover:bg-[#e8eef6] dark:hover:bg-[#1b2734]"
              >
                <span>{item.label}</span>
                {item.accelerator !== undefined && (
                  <span className="font-mono text-[10px] text-ink-muted">{item.accelerator}</span>
                )}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
