// x31Desk — the keyboard shortcut registry.
// ---------------------------------------------------------------------------
// One module decides every keyboard shortcut the application implements, so
// three things are guaranteed rather than hoped for:
//
//   * **The Settings list cannot drift from the real bindings.** Settings
//     renders this catalogue verbatim, and the shell dispatcher resolves
//     against the same entries, so what is documented is what fires.
//   * **A keystroke resolves to at most one action.** Every `shell` entry is
//     matched in a single pass by the one window listener in
//     `useShellShortcuts`; the component-owned bindings (`Ctrl+K`, `/`,
//     `Ctrl+Shift+C`, the toasts' `Esc`) use disjoint keys, which the tests
//     pin, so no keystroke can be handled twice.
//   * **Standard editing keys are never claimed.** Nothing here is a plain
//     editing combination: copy, paste, undo, redo, select-all and find stay
//     with the browser, the field and CodeMirror.
//
// Two policies keep the shortcuts safe around typing:
//
//   * Every `shell` binding is a modifier combination or a function key, so
//     firing one from inside a field, a textarea or CodeMirror cannot eat a
//     character the user meant to type — these are deliberate, safe global
//     actions. The tests assert the policy entry by entry.
//   * Bare keys (`/` in workspace search) belong to their component and are
//     registered with `ignoreWhileTyping`, so they stand down while the user
//     types.
//
// Plain data and pure functions only — no DOM, no React — so the unit tests
// drive it with synthetic events while the shell and the Settings page both
// read the one source of truth.
import type { ViewId, ViewIntent } from '@/types/navigation'

/** One key combination, matched against a `KeyboardEvent`. */
export type ShortcutKeySpec = {
  /** The `KeyboardEvent.key` value, compared case-insensitively. */
  key: string
  /** Ctrl (Windows/Linux) or Cmd (macOS). Absent means "no modifier held at all". */
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

/**
 * The properties a binding matches on. A real `KeyboardEvent` satisfies this,
 * and so does a plain object in a test — which is how the dispatcher is
 * exercised without a DOM.
 */
export type KeyEventLike = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

type NavShortcutId = `go-${ViewId}`

export type ShortcutId =
  | NavShortcutId
  | 'new-item'
  | 'save'
  | 'rename'
  | 'refresh'
  | 'search'
  | 'copy-snippet'
  | 'close'

/** The two groups Settings lists, in order. */
export type ShortcutGroup = 'Navigation' | 'Actions'

/**
 * Who answers the keystroke.
 *
 * `shell` entries are dispatched centrally by `useShellShortcuts`. The others
 * are handled by the component where the behaviour lives — the search field,
 * the snippets page, the dialog layer — and appear in the catalogue only so
 * Settings can document them accurately.
 */
export type ShortcutOwner = 'shell' | 'search' | 'snippet' | 'dialogs'

export type ShortcutDefinition = {
  id: ShortcutId
  group: ShortcutGroup
  /** The action, worded for the Settings list. */
  label: string
  owner: ShortcutOwner
  /** Any one of these fires the shortcut. */
  bindings: readonly ShortcutKeySpec[]
}

/**
 * Sidebar order doubles as key order: the first entry is `Ctrl+1`, the second
 * `Ctrl+2` and so on — the convention browser tabs use, which is why Archive
 * and Settings fit as `Ctrl+5` and `Ctrl+6` rather than inventing keys.
 */
export const NAVIGATION_KEYS: readonly (readonly [ViewId, string])[] = [
  ['home', '1'],
  ['notes', '2'],
  ['tasks', '3'],
  ['snippets', '4'],
  ['archive', '5'],
  ['settings', '6'],
]

const NAV_SHORTCUTS: readonly ShortcutDefinition[] = NAVIGATION_KEYS.map(
  ([view, key]): ShortcutDefinition => ({
    id: `go-${view}`,
    group: 'Navigation',
    label: `Go to ${view.charAt(0).toUpperCase()}${view.slice(1)}`,
    owner: 'shell',
    bindings: [{ key, ctrl: true }],
  }),
)

/**
 * Every shortcut the application implements, in Settings display order.
 */
export const SHORTCUTS: readonly ShortcutDefinition[] = [
  ...NAV_SHORTCUTS,
  {
    id: 'search',
    group: 'Actions',
    label: 'Search the workspace',
    owner: 'search',
    bindings: [{ key: 'k', ctrl: true }, { key: '/' }],
  },
  {
    id: 'new-item',
    group: 'Actions',
    label: 'New note, task or snippet',
    owner: 'shell',
    bindings: [{ key: 'n', ctrl: true }],
  },
  {
    id: 'save',
    group: 'Actions',
    label: 'Save pending changes now',
    owner: 'shell',
    bindings: [{ key: 's', ctrl: true }],
  },
  {
    id: 'rename',
    group: 'Actions',
    label: 'Focus the title to rename it',
    owner: 'shell',
    bindings: [{ key: 'F2' }],
  },
  {
    id: 'refresh',
    group: 'Actions',
    label: 'Save and refresh the workspace',
    owner: 'shell',
    bindings: [{ key: 'F5' }],
  },
  {
    id: 'copy-snippet',
    group: 'Actions',
    label: "Copy the open snippet's code",
    owner: 'snippet',
    bindings: [{ key: 'c', ctrl: true, shift: true }],
  },
  {
    id: 'close',
    group: 'Actions',
    label: 'Close a dialog or cancel',
    owner: 'dialogs',
    bindings: [{ key: 'Escape' }],
  },
]

/** Group order as Settings renders them. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['Navigation', 'Actions']

/** The catalogue entry with the given id; throwing means the id is a typo. */
export function shortcutById(id: ShortcutId): ShortcutDefinition {
  const shortcut = SHORTCUTS.find((entry) => entry.id === id)

  if (shortcut === undefined) {
    throw new Error(`Unknown shortcut id: ${id}`)
  }

  return shortcut
}

/** Renders one binding the way every surface spells it: `Ctrl + Shift + C`. */
export function formatBinding(spec: ShortcutKeySpec): string {
  const parts: string[] = []

  if (spec.ctrl === true) {
    parts.push('Ctrl')
  }

  if (spec.alt === true) {
    parts.push('Alt')
  }

  if (spec.shift === true) {
    parts.push('Shift')
  }

  parts.push(spec.key === 'Escape' ? 'Esc' : spec.key.toUpperCase())

  return parts.join(' + ')
}

/**
 * Whether `event` is exactly `spec`: the same modifier state (Ctrl on
 * Windows/Linux, Cmd on macOS, matched through either) and the same key.
 *
 * Deliberately strict — `Ctrl+Shift+C` must not fire on plain `Ctrl+C` — and
 * deliberately the *only* matching implementation, so the generic
 * `useKeyboardShortcut` hook and the shell dispatcher can never disagree.
 */
export function matchesShortcut(event: KeyEventLike, spec: ShortcutKeySpec): boolean {
  const isModifierMatch = spec.ctrl === true ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey

  if (!isModifierMatch || event.shiftKey !== (spec.shift === true) || event.altKey !== (spec.alt === true)) {
    return false
  }

  return event.key.toLowerCase() === spec.key.toLowerCase()
}

/**
 * Whether the event came from somewhere the user types: a field, a `<select>`
 * or CodeMirror's contenteditable surface.
 *
 * Duck-typed on purpose. `instanceof HTMLElement` would tie this module to a
 * browser realm (and the unit tests run in plain Node); reading `tagName` and
 * `isContentEditable` answers the same question for every element and returns
 * `false` for `window`, which has neither.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') {
    return false
  }

  const element = target as { isContentEditable?: unknown; tagName?: unknown }

  if (element.isContentEditable === true) {
    return true
  }

  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : ''

  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** What the shell does about a keystroke, once one matches. */
export type ShellShortcutAction =
  | { type: 'navigate'; view: ViewId }
  /** `view` is where the item is created; `intent` is what the view performs. */
  | { type: 'new-item'; view: ViewId; intent: ViewIntent }
  | { type: 'save' }
  | { type: 'rename' }
  | { type: 'refresh' }

export type ShellShortcutContext = {
  /** The view showing, so `Ctrl+N` creates what the section holds. */
  activeView: ViewId
  /** A modal `<dialog>` is open. */
  dialogOpen: boolean
  /** The page offers a title field for `F2` to focus. */
  hasRenameTarget: boolean
}

/**
 * Where a new item belongs. Notes, Tasks and Snippets create their own kind;
 * the sections that cannot create anything (Home, Archive, Settings) fall back
 * to Notes — the behaviour `Ctrl+N` had before it became section-aware — so
 * the shortcut is never dead.
 */
function newItemDestination(activeView: ViewId): ViewId {
  switch (activeView) {
    case 'tasks':
      return 'tasks'
    case 'snippets':
      return 'snippets'
    default:
      return 'notes'
  }
}

function newItemIntent(destination: ViewId): ViewIntent {
  if (destination === 'tasks') {
    return { type: 'create-task' }
  }

  if (destination === 'snippets') {
    return { type: 'create-snippet' }
  }

  return { type: 'create-note' }
}

/**
 * Resolves a keystroke to the one shell action it means, or `null` when the
 * key belongs to another owner or the context stands the shortcut down.
 *
 * The context is read fresh at dispatch time so a modal dialog can hold
 * navigation, creation and renaming back without unbinding anything — while
 * saving and refreshing stay available from anywhere, because neither can
 * discard what the dialog is collecting.
 */
export function resolveShellShortcut(
  event: KeyEventLike,
  context: ShellShortcutContext,
): ShellShortcutAction | null {
  const shortcut = SHORTCUTS.find(
    (entry) => entry.owner === 'shell' && entry.bindings.some((binding) => matchesShortcut(event, binding)),
  )

  if (shortcut === undefined) {
    return null
  }

  const blockedByDialog = context.dialogOpen

  switch (shortcut.id) {
    case 'go-home':
      return blockedByDialog ? null : { type: 'navigate', view: 'home' }
    case 'go-notes':
      return blockedByDialog ? null : { type: 'navigate', view: 'notes' }
    case 'go-tasks':
      return blockedByDialog ? null : { type: 'navigate', view: 'tasks' }
    case 'go-snippets':
      return blockedByDialog ? null : { type: 'navigate', view: 'snippets' }
    case 'go-archive':
      return blockedByDialog ? null : { type: 'navigate', view: 'archive' }
    case 'go-settings':
      return blockedByDialog ? null : { type: 'navigate', view: 'settings' }
    case 'new-item': {
      if (blockedByDialog) {
        return null
      }

      const destination = newItemDestination(context.activeView)
      return { type: 'new-item', view: destination, intent: newItemIntent(destination) }
    }
    case 'rename':
      if (blockedByDialog || !context.hasRenameTarget) {
        return null
      }
      return { type: 'rename' }
    case 'save':
      return { type: 'save' }
    case 'refresh':
      return { type: 'refresh' }
    // Handled where the behaviour lives: the search field, the snippets page
    // and the dialog layer each bind their own key. Listed here for Settings,
    // never dispatched from here.
    case 'search':
    case 'copy-snippet':
    case 'close':
      return null
  }
}
