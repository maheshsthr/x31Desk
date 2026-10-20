// x31Desk — the custom title bar's menu definitions.
// ---------------------------------------------------------------------------
// One module decides what the File / Edit / View / Help menus contain, in the
// same spirit as the shortcut registry: the accelerators are *read from* the
// registry rather than typed twice, so a menu row and the Settings list can
// never advertise different keys, and the shell-backed rows carry the very
// `ShellShortcutAction` the keyboard dispatcher performs — the menu and the
// keystroke are two inputs to one code path.
//
// Plain data and pure functions only — no DOM, no React — so the unit tests
// import it directly and assert the rows, their actions and their accelerators.
//
// Two deliberate omissions, both because a menu row must do what it says:
//
//   * No edit command is offered that cannot run safely in renderer
//     content; the standard clipboard shortcut still works through
//     the focused field's own editing handling.
//   * **Nothing is offered that has no action.** Every row here resolves to a
//     real behaviour in the shell, the editors or the window itself; rows that
//     could not (Print, About-dialog links, …) simply do not exist.
import type { EditCommand } from '@/components/titlebar/editCommands'
import {
  formatBinding,
  shortcutById,
  type ShellShortcutAction,
  type ShortcutId,
} from '@/shortcuts/shortcuts'
import type { ViewId } from '@/types/navigation'

/** The Settings sections Help can jump to. */
export type HelpSectionId = 'shortcuts' | 'about'

/**
 * What one menu row does.
 *
 * The shell actions are exactly the keyboard dispatcher's vocabulary; the rest
 * are local to the title bar itself (theme, editors, window).
 */
export type TitleBarAction =
  | ShellShortcutAction
  | { readonly type: 'toggle-theme' }
  | { readonly type: 'edit'; readonly command: EditCommand }
  | { readonly type: 'help-section'; readonly section: HelpSectionId }
  | { readonly type: 'exit' }

export type TitleBarItem =
  | { readonly kind: 'separator'; readonly id: string }
  | {
      readonly kind: 'item'
      readonly id: string
      readonly label: string
      /** Shown right-aligned; sourced from the shortcut registry or a standard editing key. */
      readonly accelerator?: string
      readonly action: TitleBarAction
      /** Only shown when the preload bridge is present (i.e. in Electron). */
      readonly desktopOnly?: boolean
    }

export type TitleBarMenu = {
  readonly id: string
  readonly label: string
  readonly items: readonly TitleBarItem[]
}

/** The first binding of a registry entry, spelled the way every surface spells it. */
function accelerator(id: ShortcutId): string {
  return formatBinding(shortcutById(id).bindings[0])
}

/** A standard editing combination. Displayed, never registered as a binding. */
const editing = {
  undo: 'Ctrl + Z',
  redo: 'Ctrl + Y',
  cut: 'Ctrl + X',
  copy: 'Ctrl + C',
  selectAll: 'Ctrl + A',
} as const

const separator = (id: string): TitleBarItem => ({ kind: 'separator', id })

/** The six sidebar destinations, each with its registry accelerator. */
const navigationItems: TitleBarItem[] = (
  [
    ['home', 'Home'],
    ['notes', 'Notes'],
    ['tasks', 'Tasks'],
    ['snippets', 'Snippets'],
    ['archive', 'Archive'],
    ['settings', 'Settings'],
  ] as const satisfies readonly (readonly [ViewId, string])[]
).map(([view, label]) => ({
  kind: 'item',
  id: `go-${view}`,
  label,
  accelerator: accelerator(`go-${view}` as ShortcutId),
  action: { type: 'navigate', view },
}))

export const TITLE_BAR_MENUS: readonly TitleBarMenu[] = [
  {
    id: 'file',
    label: 'File',
    items: [
      {
        kind: 'item',
        id: 'new-note',
        label: 'New Note',
        accelerator: accelerator('new-item'),
        action: { type: 'new-item', view: 'notes', intent: { type: 'create-note' } },
      },
      {
        kind: 'item',
        id: 'new-task',
        label: 'New Task',
        accelerator: accelerator('new-item'),
        action: { type: 'new-item', view: 'tasks', intent: { type: 'create-task' } },
      },
      {
        kind: 'item',
        id: 'new-snippet',
        label: 'New Snippet',
        accelerator: accelerator('new-item'),
        action: { type: 'new-item', view: 'snippets', intent: { type: 'create-snippet' } },
      },
      separator('file-2'),
      {
        kind: 'item',
        id: 'save',
        label: 'Save Now',
        accelerator: accelerator('save'),
        action: { type: 'save' },
      },
      separator('file-3'),
      {
        kind: 'item',
        id: 'exit',
        label: 'Exit',
        // Window close shortcut.
        accelerator: 'Alt + F4',
        action: { type: 'exit' },
        desktopOnly: true,
      },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    items: [
      { kind: 'item', id: 'undo', label: 'Undo', accelerator: editing.undo, action: { type: 'edit', command: 'undo' } },
      { kind: 'item', id: 'redo', label: 'Redo', accelerator: editing.redo, action: { type: 'edit', command: 'redo' } },
      separator('edit-2'),
      { kind: 'item', id: 'cut', label: 'Cut', accelerator: editing.cut, action: { type: 'edit', command: 'cut' } },
      { kind: 'item', id: 'copy', label: 'Copy', accelerator: editing.copy, action: { type: 'edit', command: 'copy' } },
      separator('edit-3'),
      {
        kind: 'item',
        id: 'select-all',
        label: 'Select All',
        accelerator: editing.selectAll,
        action: { type: 'edit', command: 'selectAll' },
      },
    ],
  },
  {
    id: 'view',
    label: 'View',
    items: [
      ...navigationItems,
      separator('view-2'),
      { kind: 'item', id: 'toggle-theme', label: 'Toggle Theme', action: { type: 'toggle-theme' } },
      separator('view-3'),
      {
        kind: 'item',
        id: 'reload',
        label: 'Reload',
        accelerator: accelerator('refresh'),
        action: { type: 'refresh' },
      },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    items: [
      {
        kind: 'item',
        id: 'keyboard-shortcuts',
        label: 'Keyboard Shortcuts',
        action: { type: 'help-section', section: 'shortcuts' },
      },
      {
        kind: 'item',
        id: 'about',
        label: 'About x31Desk',
        action: { type: 'help-section', section: 'about' },
      },
    ],
  },
]

/** The rows a menu renders: `desktopOnly` rows stand down in a plain browser. */
export function visibleItems(
  menu: TitleBarMenu,
  isDesktop: boolean,
): readonly TitleBarItem[] {
  return menu.items.filter(
    (item) => item.kind === 'separator' || item.desktopOnly !== true || isDesktop,
  )
}
