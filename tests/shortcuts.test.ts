// The keyboard shortcut system, pinned where it can actually break.
// ---------------------------------------------------------------------------
// x31Desk's shortcuts live in one registry (`@/shortcuts/shortcuts`): the shell
// dispatcher resolves against it and the Settings list renders it verbatim, so
// these tests cover the three promises the system makes:
//
//   * **Mappings** — `Ctrl+1`…`Ctrl+6` follow the sidebar, `Ctrl+N` creates
//     what the current section holds, and the action keys are the ones the
//     Settings page advertises.
//   * **Conflict prevention** — no two entries claim the same keystroke, plain
//     editing combinations (copy/paste/undo/find…) are never claimed, shell
//     bindings are all deliberate (modifier or function key) so typing cannot
//     be eaten, and a modal dialog holds navigation back.
//   * **Dispatch** — the pure resolver turns a synthetic event plus its context
//     into exactly one action, or `null`, and the components that own the
//     remaining keys are wired at the source the registry names.
//
// Dependency-free: Node's built-in test runner, type stripping, and synthetic
// events — the resolver is deliberately DOM-free so it can be driven here.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  NAVIGATION_KEYS,
  SHORTCUTS,
  SHORTCUT_GROUPS,
  formatBinding,
  isTypingTarget,
  matchesShortcut,
  resolveShellShortcut,
  shortcutById,
  type KeyEventLike,
  type ShellShortcutContext,
} from '@/shortcuts/shortcuts'
import type { ViewId, ViewIntent } from '@/types/navigation'

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** A synthetic `KeyboardEvent`, shaped only by what a binding matches on. */
function key(
  value: string,
  modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
): KeyEventLike {
  return {
    key: value,
    ctrlKey: modifiers.ctrl === true,
    metaKey: modifiers.meta === true,
    shiftKey: modifiers.shift === true,
    altKey: modifiers.alt === true,
  }
}

function context(overrides: Partial<ShellShortcutContext> = {}): ShellShortcutContext {
  return { activeView: 'home', dialogOpen: false, hasRenameTarget: false, ...overrides }
}

// ---------------------------------------------------------------------------
// mappings
// ---------------------------------------------------------------------------

test('Ctrl+1 … Ctrl+6 follow the sidebar order', () => {
  assert.deepEqual(NAVIGATION_KEYS, [
    ['home', '1'],
    ['notes', '2'],
    ['tasks', '3'],
    ['snippets', '4'],
    ['archive', '5'],
    ['settings', '6'],
  ])

  assert.deepEqual(
    NAVIGATION_KEYS.map(([view]) => shortcutById(`go-${view}`).label),
    ['Go to Home', 'Go to Notes', 'Go to Tasks', 'Go to Snippets', 'Go to Archive', 'Go to Settings'],
  )
})

test('every action shortcut carries the binding Settings advertises', () => {
  assert.deepEqual(shortcutById('search').bindings, [{ key: 'k', ctrl: true }, { key: '/' }])
  assert.deepEqual(shortcutById('new-item').bindings, [{ key: 'n', ctrl: true }])
  assert.deepEqual(shortcutById('save').bindings, [{ key: 's', ctrl: true }])
  assert.deepEqual(shortcutById('rename').bindings, [{ key: 'F2' }])
  assert.deepEqual(shortcutById('refresh').bindings, [{ key: 'F5' }])
  assert.deepEqual(shortcutById('copy-snippet').bindings, [{ key: 'c', ctrl: true, shift: true }])
  assert.deepEqual(shortcutById('close').bindings, [{ key: 'Escape' }])
})

test('the catalogue is complete enough to render', () => {
  for (const shortcut of SHORTCUTS) {
    assert.ok(shortcut.label.length > 0, `${shortcut.id} needs a label`)
    assert.ok(shortcut.bindings.length > 0, `${shortcut.id} needs at least one binding`)
    assert.ok(
      SHORTCUT_GROUPS.includes(shortcut.group),
      `${shortcut.id} belongs to the unknown group ${shortcut.group}`,
    )
  }

  // The groups Settings renders are exactly the groups in use.
  assert.deepEqual(
    SHORTCUT_GROUPS.filter((group) => SHORTCUTS.some((shortcut) => shortcut.group === group)),
    SHORTCUT_GROUPS,
  )
})

test('formatBinding spells keys the way every surface shows them', () => {
  assert.equal(formatBinding({ key: '1', ctrl: true }), 'Ctrl + 1')
  assert.equal(formatBinding({ key: 'c', ctrl: true, shift: true }), 'Ctrl + Shift + C')
  assert.equal(formatBinding({ key: 'Escape' }), 'Esc')
  assert.equal(formatBinding({ key: 'F2' }), 'F2')
  assert.equal(formatBinding({ key: '/' }), '/')
})

// ---------------------------------------------------------------------------
// conflict prevention
// ---------------------------------------------------------------------------

test('no two shortcuts claim the same keystroke', () => {
  const claimed = new Map<string, string>()

  for (const shortcut of SHORTCUTS) {
    for (const binding of shortcut.bindings) {
      const signature = [
        binding.ctrl === true,
        binding.alt === true,
        binding.shift === true,
        binding.key.toLowerCase(),
      ].join('|')

      assert.equal(
        claimed.has(signature),
        false,
        `${shortcut.id} (${formatBinding(binding)}) clashes with ${claimed.get(signature)}`,
      )
      claimed.set(signature, shortcut.id)
    }
  }
})

test('standard editing keystrokes are never claimed', () => {
  const editing: readonly (readonly [string, { ctrl: boolean; shift?: boolean }])[] = [
    ['c', { ctrl: true }],
    ['v', { ctrl: true }],
    ['x', { ctrl: true }],
    ['a', { ctrl: true }],
    ['z', { ctrl: true }],
    ['y', { ctrl: true }],
    ['f', { ctrl: true }],
    ['z', { ctrl: true, shift: true }],
    ['y', { ctrl: true, shift: true }],
  ]

  for (const [value, modifiers] of editing) {
    const event = key(value, modifiers)

    for (const shortcut of SHORTCUTS) {
      for (const binding of shortcut.bindings) {
        assert.equal(
          matchesShortcut(event, binding),
          false,
          `${value}+ctrl must stay with the editor, but matched ${shortcut.id}`,
        )
      }
    }

    assert.equal(
      resolveShellShortcut(event, context({ activeView: 'notes', hasRenameTarget: true })),
      null,
      `${value}+ctrl must not dispatch a shell action`,
    )
  }
})

test('every shell keystroke is deliberate — a modifier or a function key', () => {
  // The typing policy: a shell shortcut may fire from inside a field or
  // CodeMirror because it can never be the character the user was typing.
  // Bare character keys belong to their component with `ignoreWhileTyping`.
  for (const shortcut of SHORTCUTS.filter((entry) => entry.owner === 'shell')) {
    for (const binding of shortcut.bindings) {
      const deliberate =
        binding.ctrl === true ||
        binding.alt === true ||
        binding.shift === true ||
        /^f\d+$/i.test(binding.key)

      assert.ok(
        deliberate,
        `${shortcut.id} (${formatBinding(binding)}) would type over the user's input`,
      )
    }
  }
})

test('matching is exact about modifiers and lenient about case', () => {
  assert.ok(matchesShortcut(key('n', { ctrl: true }), { key: 'n', ctrl: true }))
  assert.ok(matchesShortcut(key('N', { ctrl: true }), { key: 'n', ctrl: true }), 'key case is ignored')
  assert.ok(matchesShortcut(key('n', { meta: true }), { key: 'n', ctrl: true }), 'Cmd stands in for Ctrl')

  assert.equal(matchesShortcut(key('n'), { key: 'n', ctrl: true }), false, 'a bare key is not the combo')
  assert.equal(
    matchesShortcut(key('n', { ctrl: true, shift: true }), { key: 'n', ctrl: true }),
    false,
    'an extra modifier is not the combo',
  )
  assert.equal(
    matchesShortcut(key('c', { ctrl: true }), { key: 'c', ctrl: true, shift: true }),
    false,
    'Ctrl+Shift+C is not plain Ctrl+C',
  )
  assert.equal(matchesShortcut(key('F2', { ctrl: true }), { key: 'F2' }), false, 'F2 means the bare key')
})

test('typing targets are recognised without a browser realm', () => {
  const asTarget = (value: object) => value as unknown as EventTarget

  assert.equal(isTypingTarget(asTarget({ tagName: 'INPUT' })), true)
  assert.equal(isTypingTarget(asTarget({ tagName: 'textarea' })), true)
  assert.equal(isTypingTarget(asTarget({ tagName: 'SELECT' })), true)
  // CodeMirror's surface is contenteditable rather than a field.
  assert.equal(isTypingTarget(asTarget({ tagName: 'DIV', isContentEditable: true })), true)

  assert.equal(isTypingTarget(asTarget({ tagName: 'DIV' })), false)
  assert.equal(isTypingTarget(asTarget({ tagName: 'BUTTON' })), false)
  assert.equal(isTypingTarget(null), false)
  assert.equal(isTypingTarget(undefined), false)
})

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

test('navigation dispatches to the right view from any section', () => {
  const everywhere: readonly ViewId[] = ['home', 'notes', 'tasks', 'snippets', 'archive', 'settings']

  for (const [view, digit] of NAVIGATION_KEYS) {
    for (const activeView of everywhere) {
      assert.deepEqual(
        resolveShellShortcut(key(digit, { ctrl: true }), context({ activeView, hasRenameTarget: true })),
        { type: 'navigate', view },
        `Ctrl+${digit} from ${activeView}`,
      )
    }
  }
})

test('Ctrl+N creates what the current section holds', () => {
  const cases: readonly (readonly [ViewId, ViewId, ViewIntent['type']])[] = [
    ['home', 'notes', 'create-note'],
    ['notes', 'notes', 'create-note'],
    ['tasks', 'tasks', 'create-task'],
    ['snippets', 'snippets', 'create-snippet'],
    // Sections that cannot create fall back to the note the shortcut always made.
    ['archive', 'notes', 'create-note'],
    ['settings', 'notes', 'create-note'],
  ]

  for (const [activeView, view, intent] of cases) {
    assert.deepEqual(
      resolveShellShortcut(key('n', { ctrl: true }), context({ activeView })),
      { type: 'new-item', view, intent: { type: intent } },
      `Ctrl+N on ${activeView}`,
    )
  }
})

test('a modal dialog holds navigation, creation and rename back — but never saving', () => {
  const openDialog = context({ activeView: 'notes', dialogOpen: true, hasRenameTarget: true })

  assert.equal(
    resolveShellShortcut(key('2', { ctrl: true }), openDialog),
    null,
    'navigation would discard the form behind the dialog',
  )
  assert.equal(resolveShellShortcut(key('n', { ctrl: true }), openDialog), null, 'create would too')
  assert.equal(resolveShellShortcut(key('F2'), openDialog), null)

  assert.deepEqual(resolveShellShortcut(key('s', { ctrl: true }), openDialog), { type: 'save' })
  assert.deepEqual(resolveShellShortcut(key('F5'), openDialog), { type: 'refresh' })
})

test('F2 renames only where there is a title to focus', () => {
  assert.equal(
    resolveShellShortcut(key('F2'), context({ hasRenameTarget: false })),
    null,
    'Home, Archive and Settings have nothing to rename',
  )
  assert.deepEqual(
    resolveShellShortcut(key('F2'), context({ activeView: 'notes', hasRenameTarget: true })),
    { type: 'rename' },
  )
})

test('component-owned keys never reach the shell dispatcher', () => {
  for (const [event, description] of [
    [key('k', { ctrl: true }), 'Ctrl+K'],
    [key('/'), '/'],
    [key('c', { ctrl: true, shift: true }), 'Ctrl+Shift+C'],
    [key('Escape'), 'Escape'],
  ] as const) {
    assert.equal(
      resolveShellShortcut(event, context({ activeView: 'notes', hasRenameTarget: true })),
      null,
      `${description} belongs to the component that owns it`,
    )
  }
})

// ---------------------------------------------------------------------------
// the wiring these behaviours depend on, pinned at the source
// ---------------------------------------------------------------------------

test('the shell dispatches through exactly one listener', () => {
  const shell = source('../src/layouts/AppShell.tsx')
  const layer = source('../src/hooks/useShellShortcuts.ts')

  assert.match(shell, /useShellShortcuts\(\{ activeView, onNavigate \}\)/, 'AppShell installs the layer')
  assert.doesNotMatch(shell, /useKeyboardShortcut/, 'no second Ctrl+N path may reappear in the shell')
  assert.doesNotMatch(shell, /requestIntent/, 'create intents come from the layer, not the shell')

  const listeners = layer.match(/window\.addEventListener\('keydown'/g) ?? []
  assert.equal(listeners.length, 1, 'the layer owns a single window listener')
  assert.match(layer, /resolveShellShortcut\(/, 'the layer dispatches through the registry')
  assert.match(layer, /dialog\[open\]/, 'a modal dialog must be able to stand shortcuts down')
  assert.match(layer, /event\.preventDefault\(\)/, 'consumed keys must not race the browser')
  assert.match(layer, /saveQueue/, 'Ctrl+S and F5 go through the shared save queue')
  assert.match(layer, /flushAll\(\)/, 'refresh drains pending writes before reloading')
})

test('Settings renders the registry rather than a copy of it', () => {
  const page = source('../src/pages/SettingsPage.tsx')

  assert.match(page, /id="shortcuts"/, 'the Keyboard Shortcuts section exists')
  assert.match(page, /SHORTCUT_GROUPS\.map/, 'groups are rendered from the registry')
  assert.match(page, /SHORTCUTS\.filter/, 'rows are filtered from the registry')
  assert.match(page, /formatBinding\(binding\)/, 'keys are spelled by the shared formatter')
  assert.match(page, /<Kbd\b/, 'keys render through the shared chip')
})

test('each component-owned binding is registered where the catalogue says it is', () => {
  const search = source('../src/components/search/WorkspaceSearch.tsx')
  const snippets = source('../src/pages/SnippetsPage.tsx')

  assert.match(
    search,
    /useKeyboardShortcut\('k', \{ ctrlOrMeta: true \}/,
    'Ctrl+K focuses the workspace search',
  )
  assert.match(
    search,
    /useKeyboardShortcut\('\/', \{ ignoreWhileTyping: true \}/,
    '/ stands down while the user types',
  )
  assert.match(search, /shortcutById\('search'\)/, 'the field hint reads the catalogue')

  assert.match(
    snippets,
    /useKeyboardShortcut\(\s*'c',\s*\{ ctrlOrMeta: true, shift: true/,
    'Ctrl+Shift+C copies the open snippet',
  )
})

test('Escape is owned by the surfaces that close, without swallowing the key', () => {
  const confirm = source('../src/components/ui/ConfirmDialog.tsx')
  const taskDialog = source('../src/components/tasks/TaskDialog.tsx')
  const toasts = source('../src/components/ui/ToastProvider.tsx')

  // `Esc` closes a native dialog through its `cancel` event; these handlers
  // keep React state in step with the element instead of letting it close
  // behind the component's back.
  assert.match(confirm, /onCancel=\{\(event\)/, 'ConfirmDialog reports the cancel')
  assert.match(taskDialog, /onCancel=\{\(event\)/, 'TaskDialog reports the cancel')

  assert.match(
    toasts,
    /useKeyboardShortcut\('Escape', \{ enabled: toasts\.length > 0, preventDefault: false \}/,
    'the toast sweep must leave Esc free for dialogs',
  )
})

test('the Ctrl+N create-snippet intent reaches the snippets workspace', () => {
  const intents = source('../src/types/navigation.ts')
  const snippets = source('../src/pages/SnippetsPage.tsx')

  assert.match(intents, /type: 'create-snippet'/, 'the intent type is declared')
  assert.match(snippets, /intent\.type === 'create-snippet'/, 'SnippetsPage claims it')
  assert.match(snippets, /startCreate\(\)/, 'through the same path as the page button')
})

test('both editors expose a title for F2 to focus', () => {
  assert.match(
    source('../src/components/notes/NoteEditor.tsx'),
    /data-rename-target/,
    'the note title is the rename target',
  )
  assert.match(
    source('../src/components/snippets/SnippetEditor.tsx'),
    /data-rename-target/,
    'the snippet title is the rename target',
  )
})

test('the generic hook shares the one matching implementation', () => {
  const hook = source('../src/hooks/useKeyboardShortcut.ts')

  assert.match(hook, /matchesShortcut\(event/, 'matching lives in the registry module')
  assert.match(hook, /isTypingTarget/, 'typing detection is shared with the registry module')
  assert.doesNotMatch(hook, /instanceof HTMLElement/, 'typing detection must stay realm-independent')
})
