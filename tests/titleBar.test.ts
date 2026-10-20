// The custom title bar, pinned where it can actually break.
// ---------------------------------------------------------------------------
// The title bar is the window's chrome: the brand, the File / Edit / View /
// Help menus and the caption buttons. Three promises are worth testing:
//
//   * **The menus are one vocabulary with the keyboard.** Every shell-backed row
//     carries the same `ShellShortcutAction` a keystroke resolves to, and its
//     accelerator is read from the shortcut registry rather than typed twice, so
//     the menu and `Ctrl+N`/`Ctrl+1`/`F5` can never disagree. The Edit rows are
//     exactly the operations the runner supports — no Paste, because Chromium
//     blocks it in renderer content — and every row does something.
//   * **The Edit runner targets the right field.** Behaviour is exercised with a
//     fake document: the active editable wins, a remembered editable is
//     restored, and with nothing editable the command does not run at all.
//   * **The window controls are real and optional.** The caption buttons call
//     only the validated bridge, they follow the pushed maximize state, and in
//     a browser (no bridge) the whole group and File → Exit stand down while
//     the menus keep working.
//
// Dependency-free: Node's built-in test runner and type stripping. Pure
// modules are imported and driven directly; components are asserted at the
// source, the way the shell's other wiring is.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  runEditCommand,
  installEditableFocusTracking,
} from '@/components/titlebar/editCommands'
import {
  TITLE_BAR_MENUS,
  visibleItems,
  type TitleBarAction,
  type TitleBarItem,
} from '@/components/titlebar/titleBarMenus'
import { formatBinding, shortcutById } from '@/shortcuts/shortcuts'

const at = (relative: string) => new URL(relative, import.meta.url)
const source = (relative: string) => readFileSync(at(relative), 'utf8')

const SHELL_ACTION_TYPES = new Set(['navigate', 'new-item', 'save', 'rename', 'refresh'])
const EDIT_COMMANDS = ['undo', 'redo', 'cut', 'copy', 'selectAll']

/** Every actionable row, across all menus, flattened. */
function rows(): Extract<TitleBarItem, { kind: 'item' }>[] {
  return TITLE_BAR_MENUS.flatMap((menu) => menu.items.filter((item) => item.kind === 'item'))
}

const rowById = (id: string) => rows().find((row) => row.id === id)

/** The registry spelling of a shortcut, as every surface renders it. */
const acceleratorOf = (id: Parameters<typeof shortcutById>[0]) =>
  formatBinding(shortcutById(id).bindings[0])

test('the bar offers exactly File, Edit, View and Help', () => {
  assert.deepEqual(
    TITLE_BAR_MENUS.map((menu) => menu.label),
    ['File', 'Edit', 'View', 'Help'],
  )
  assert.deepEqual(
    TITLE_BAR_MENUS.map((menu) => menu.id),
    ['file', 'edit', 'view', 'help'],
  )
})

test('every row does something, and ids are unique across the bar', () => {
  const ids = new Set<string>()
  const actions: TitleBarAction[] = []

  for (const menu of TITLE_BAR_MENUS) {
    for (const item of menu.items) {
      assert.equal(ids.has(item.id), false, `duplicate row id: ${item.id}`)
      ids.add(item.id)

      if (item.kind === 'item') {
        assert.notEqual(item.label.trim(), '', `row ${item.id} has no label`)
        actions.push(item.action)
      }
    }
  }

  assert.equal(actions.length, rows().length)
  assert.ok(actions.length > 0)
})

test('shell-backed rows carry the shell vocabulary, so menu and keyboard cannot drift', () => {
  for (const row of rows()) {
    const action = row.action as { type: string; view?: string; intent?: { type: string } }

    if (SHELL_ACTION_TYPES.has(action.type)) {
      assert.equal(action.type in { navigate: 1, 'new-item': 1, save: 1, rename: 1, refresh: 1 }, true)

      if (action.type === 'new-item') {
        assert.equal(typeof action.view, 'string', `row ${row.id} must name its destination`)
        assert.equal(typeof action.intent?.type, 'string', `row ${row.id} must carry its intent`)
      }
    }
  }

  // The concrete pairings the bar exists to provide.
  assert.deepEqual(rowById('new-note')?.action, {
    type: 'new-item',
    view: 'notes',
    intent: { type: 'create-note' },
  })
  assert.deepEqual(rowById('new-task')?.action, {
    type: 'new-item',
    view: 'tasks',
    intent: { type: 'create-task' },
  })
  assert.deepEqual(rowById('new-snippet')?.action, {
    type: 'new-item',
    view: 'snippets',
    intent: { type: 'create-snippet' },
  })
  assert.deepEqual(rowById('save')?.action, { type: 'save' })
  assert.deepEqual(rowById('reload')?.action, { type: 'refresh' })
  assert.deepEqual(rowById('exit')?.action, { type: 'exit' })
})

test('accelerators are read from the registry, never typed twice', () => {
  assert.equal(rowById('new-note')?.accelerator, acceleratorOf('new-item'))
  assert.equal(rowById('new-note')?.accelerator, 'Ctrl + N')
  assert.equal(rowById('save')?.accelerator, acceleratorOf('save'))
  assert.equal(rowById('reload')?.accelerator, acceleratorOf('refresh'))
  assert.equal(rowById('reload')?.accelerator, 'F5')

  for (const [view, key] of [
    ['home', '1'],
    ['notes', '2'],
    ['tasks', '3'],
    ['snippets', '4'],
    ['archive', '5'],
    ['settings', '6'],
  ] as const) {
    assert.equal(
      rowById(`go-${view}`)?.accelerator,
      acceleratorOf(`go-${view}`),
      `the ${view} row must show the registry's Ctrl+${key}`,
    )
  }
})

test('the View menu lists every destination and only real toggles', () => {
  const view = TITLE_BAR_MENUS.find((menu) => menu.id === 'view')
  assert.ok(view)

  const labels = visibleItems(view, true)
    .filter((item) => item.kind === 'item')
    .map((item) => item.label)

  assert.deepEqual(labels, [
    'Home',
    'Notes',
    'Tasks',
    'Snippets',
    'Archive',
    'Settings',
    'Toggle Theme',
    'Reload',
  ])

  assert.equal(rowById('toggle-theme')?.accelerator, undefined, 'the theme toggle has no key')
})

test('the Edit menu is exactly the operations the runner implements — no Paste', () => {
  const edit = TITLE_BAR_MENUS.find((menu) => menu.id === 'edit')
  assert.ok(edit)

  const commands = edit.items
    .filter((item) => item.kind === 'item')
    .map((item) => (item.action.type === 'edit' ? item.action.command : item.action.type))

  assert.deepEqual(commands, EDIT_COMMANDS)

  // Chromium blocks `document.execCommand('paste')` in renderer content, so a
  // Paste row could only ever no-op. It must not be offered anywhere.
  const menuSource = source('../src/components/titlebar/titleBarMenus.ts')
  assert.doesNotMatch(menuSource, /paste/i)
})

test('Help points at the two Settings sections it names', () => {
  assert.deepEqual(rowById('keyboard-shortcuts')?.action, {
    type: 'help-section',
    section: 'shortcuts',
  })
  assert.deepEqual(rowById('about')?.action, { type: 'help-section', section: 'about' })
})

test('Exit is desktop-only; the browser keeps every other row', () => {
  const file = TITLE_BAR_MENUS.find((menu) => menu.id === 'file')
  assert.ok(file)

  const desktop = visibleItems(file, true).filter((item) => item.kind === 'item')
  const browser = visibleItems(file, false).filter((item) => item.kind === 'item')

  assert.deepEqual(
    desktop.map((item) => item.label),
    ['New Note', 'New Task', 'New Snippet', 'Save Now', 'Exit'],
  )
  assert.deepEqual(
    browser.map((item) => item.label),
    ['New Note', 'New Task', 'New Snippet', 'Save Now'],
  )

  // Separators survive filtering, so the browser menu keeps its shape.
  assert.equal(visibleItems(file, false).filter((item) => item.kind === 'separator').length, 2)
})

test('the menu definitions are plain data — no React, no DOM', () => {
  const menuSource = source('../src/components/titlebar/titleBarMenus.ts')

  assert.doesNotMatch(menuSource, /from 'react'/)
  assert.doesNotMatch(menuSource, /\bdocument\./)
  assert.doesNotMatch(menuSource, /\bwindow\./)
})

test('the Edit runner acts on the active editable and reports its result', () => {
  const executed: string[] = []
  const doc = {
    activeElement: { tagName: 'INPUT' },
    execCommand: (command: string) => {
      executed.push(command)
      return true
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }

  assert.equal(runEditCommand('undo', doc), true)
  assert.deepEqual(executed, ['undo'])

  // A false result from the field is passed straight back, never masked.
  doc.execCommand = () => false
  assert.equal(runEditCommand('copy', doc), false)
})

test('the Edit runner restores the last field the user typed in', () => {
  const listeners = new Map<string, (event: Event) => void>()
  const focused: string[] = []
  const executed: string[] = []
  const field = {
    tagName: 'TEXTAREA',
    focus: () => focused.push('field'),
  }
  const doc = {
    activeElement: { tagName: 'BUTTON' } as unknown,
    execCommand: (command: string) => {
      executed.push(command)
      return true
    },
    addEventListener: (type: string, listener: (event: Event) => void) => {
      listeners.set(type, listener)
    },
    removeEventListener: (type: string) => {
      listeners.delete(type)
    },
  }

  const unsubscribe = installEditableFocusTracking(doc)

  // The user types in the field; focus then moves to a menu button.
  listeners.get('focusin')?.({ target: field } as unknown as Event)
  assert.equal(runEditCommand('selectAll', doc), true)

  assert.deepEqual(focused, ['field'], 'the remembered field is refocused before the command')
  assert.deepEqual(executed, ['selectAll'])

  unsubscribe()
  assert.equal(listeners.has('focusin'), false, 'unsubscribing detaches the listener')
})

test('the Edit runner does nothing when there is no editable target', () => {
  const executed: string[] = []
  const doc = {
    activeElement: { tagName: 'BUTTON' },
    execCommand: (command: string) => {
      executed.push(command)
      return true
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }

  assert.equal(runEditCommand('cut', doc), false)
  assert.deepEqual(executed, [], 'a command with nothing to act on must not run blind')
})

test('the shell renders the title bar as the window-wide first row', () => {
  const shell = source('../src/layouts/AppShell.tsx')

  assert.match(shell, /flex h-dvh flex-col/, 'the shell must stack chrome above the workspace')
  assert.ok(
    shell.indexOf('<TitleBar') < shell.indexOf('<Sidebar'),
    'the title bar must come before the sidebar it spans above',
  )
  assert.match(shell, /<TitleBar onNavigate=\{onNavigate\} \/>/)
})

test('the title bar is a drag region whose controls opt out', () => {
  const bar = source('../src/components/titlebar/TitleBar.tsx')

  assert.match(bar, /app-region-drag/)
  assert.match(bar, /app-region-no-drag/)
  assert.match(bar, /data-title-bar/)
  assert.match(bar, /data-window-control="minimize"/)
  assert.match(bar, /data-window-control="maximize"/)
  assert.match(bar, /data-window-control="close"/)
  assert.match(bar, /label="Minimize"/)
  assert.match(bar, /'Restore Down' : 'Maximize'/)
  assert.match(bar, /label="Close"/)
  assert.match(bar, /<BrandMark variant="mark"/)

  // The caption buttons stand down without the bridge, and only then.
  assert.match(bar, /controls !== null &&/)
  assert.match(bar, /useWindowControls\(\)/)
})

test('the menus and their rows never start a window drag or steal focus', () => {
  const menu = source('../src/components/titlebar/TitleBarMenu.tsx')

  assert.match(menu, /app-region-no-drag/)
  assert.match(menu, /role="menu"/)
  assert.match(menu, /role="menuitem"/)
  assert.equal(
    [...menu.matchAll(/onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/g)].length,
    2,
    'both the trigger and every row must preserve focus',
  )
  assert.match(menu, /aria-haspopup="menu"/)
  assert.match(menu, /aria-expanded=\{open\}/)
})

test('menu rows run the same code path as the keyboard, and the shell-only actions go through it', () => {
  const bar = source('../src/components/titlebar/TitleBar.tsx')

  assert.match(bar, /import \{ performShellAction \} from '@\/hooks\/useShellShortcuts'/)
  assert.match(bar, /performShellAction\(action, \{ onNavigate, notify \}\)/)
  // Creation travels as an intent through the shell action, not by reaching
  // into the navigation intent store from the chrome.
  assert.doesNotMatch(bar, /requestIntent/)
  assert.match(bar, /runEditCommand\(action\.command\)/)
  assert.match(bar, /toggleTheme\(\)/)
  assert.match(bar, /controls\?\.close\(\)/)

  // The bar closes on Escape (swallowing it, so nothing else reacts) and on a
  // press outside itself.
  assert.match(bar, /event\.key === 'Escape'/)
  assert.match(bar, /event\.stopPropagation\(\)/)
  assert.match(bar, /addEventListener\('pointerdown', onPointerDown, true\)/)
})

test('Help reveals a Settings section rather than merely navigating', () => {
  const bar = source('../src/components/titlebar/TitleBar.tsx')

  assert.match(bar, /onNavigate\('settings'\)/)
  assert.match(bar, /document\.getElementById\(section\)/)
  assert.match(bar, /scrollIntoView/)
})

test('the shell keeps one keyboard listener and exports the shared dispatcher', () => {
  const layer = source('../src/hooks/useShellShortcuts.ts')

  assert.equal(
    [...layer.matchAll(/window\.addEventListener\('keydown'/g)].length,
    1,
    'the menu must not add a second shell key listener',
  )
  assert.match(layer, /export function performShellAction\(/)
  assert.match(layer, /resolveShellShortcut\(event, \{/)
})

test('the window controls hook reads the state and follows the pushes', () => {
  const hook = source('../src/hooks/useWindowControls.ts')

  assert.match(hook, /window\.x31deskDesktop\?\.windowControls/)
  assert.match(hook, /onMaximizedChanged/)
  assert.match(hook, /getState\(\)/)
  assert.match(hook, /if \(!controls\) \{\s*return null/)
  assert.match(hook, /unsubscribe\(\)/, 'the subscription must be torn down')
})

test('the sidebar no longer repeats the logo the title bar owns', () => {
  const sidebar = source('../src/components/layout/Sidebar.tsx')

  assert.doesNotMatch(sidebar, /BrandMark/, 'the logo appears once, in the title bar')
  assert.match(sidebar, /aria-label="Workspace sections"/)
})
