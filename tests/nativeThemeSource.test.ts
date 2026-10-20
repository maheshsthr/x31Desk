// The renderer's half of native-chrome theming, in isolation.
// ---------------------------------------------------------------------------
// `installNativeThemeSource` reads the app's theme preference and reports it to
// the main process, then keeps reporting whenever the preference moves. These
// tests drive it with a fake store and a fake bridge, so the behaviour the
// title-bar theming depends on is pinned without Electron, React or a DOM:
//
//   * the persisted preference is reported once, on install;
//   * a change is reported, but an emit that does not move the preference (an
//     editor tweak) is not reported again;
//   * repeated identical preferences are de-duplicated;
//   * a failed report is surfaced, never swallowed silently;
//   * unsubscribing stops the reporting;
//   * in a browser (no bridge) installation is a harmless no-op.
//
// Dependency-free: Node's built-in test runner and type stripping.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { installNativeThemeSource, type ThemePreferenceStore } from '@/data/nativeThemeSource'
import type { IpcResult } from '@/data/ipc/contract'
import type { DesktopThemeBridge } from '@/types/desktop'
import type { ThemePreference } from '@/types/theme'

/** Lets the pending promise chains run before a test asserts. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** A stand-in settings store the test can move and emit from. */
function createStore(initial: ThemePreference) {
  const listeners = new Set<() => void>()
  let preference = initial

  const store: ThemePreferenceStore = {
    getSnapshot: () => ({ themePreference: preference }),
    subscribe: (listener) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
  }

  return {
    store,
    setTheme(next: ThemePreference) {
      preference = next
      for (const listener of [...listeners]) {
        listener()
      }
    },
    /** Emits without moving the preference, as an editor tweak would. */
    emit() {
      for (const listener of [...listeners]) {
        listener()
      }
    },
    listenerCount: () => listeners.size,
  }
}

/** A fake theme bridge that records every preference it is handed. */
function createBridge(response: IpcResult<void> = { ok: true, value: undefined }) {
  const preferences: ThemePreference[] = []
  let rejection: unknown = null

  const bridge: DesktopThemeBridge = {
    setSource: async (request) => {
      preferences.push(request.preference)

      if (rejection !== null) {
        throw rejection
      }

      return response
    },
  }

  return {
    bridge,
    preferences,
    rejectWith(error: unknown) {
      rejection = error
    },
  }
}

test('reports the persisted preference once, on install', async () => {
  const fake = createBridge()
  const fakeStore = createStore('dark')

  installNativeThemeSource({ bridge: fake.bridge, store: fakeStore.store })
  await tick()

  assert.deepEqual(fake.preferences, ['dark'])
})

test('reports a change, but not an emit that leaves the preference alone', async () => {
  const fake = createBridge()
  const fakeStore = createStore('light')

  installNativeThemeSource({ bridge: fake.bridge, store: fakeStore.store })
  await tick()

  // An editor tweak emits with the same preference: no second report.
  fakeStore.emit()
  await tick()
  assert.deepEqual(fake.preferences, ['light'])

  fakeStore.setTheme('dark')
  await tick()
  assert.deepEqual(fake.preferences, ['light', 'dark'])
})

test('de-duplicates a preference set to the value it already held', async () => {
  const fake = createBridge()
  const fakeStore = createStore('system')

  installNativeThemeSource({ bridge: fake.bridge, store: fakeStore.store })
  await tick()

  fakeStore.setTheme('system')
  await tick()

  assert.deepEqual(fake.preferences, ['system'])
})

test('a rejected report is surfaced rather than swallowed', async () => {
  const fake = createBridge()
  const failure = new Error('ipc gone')
  fake.rejectWith(failure)

  const errors: unknown[] = []
  installNativeThemeSource({
    bridge: fake.bridge,
    store: createStore('dark').store,
    onError: (error) => errors.push(error),
  })
  await tick()

  assert.deepEqual(errors, [failure])
})

test('a failure response is surfaced rather than swallowed', async () => {
  const fake = createBridge({ ok: false, kind: 'unknown' })

  const errors: unknown[] = []
  installNativeThemeSource({
    bridge: fake.bridge,
    store: createStore('dark').store,
    onError: (error) => errors.push(error),
  })
  await tick()

  assert.equal(errors.length, 1)
  assert.ok(errors[0] instanceof Error)
})

test('unsubscribing stops the reporting', async () => {
  const fake = createBridge()
  const fakeStore = createStore('light')

  const uninstall = installNativeThemeSource({ bridge: fake.bridge, store: fakeStore.store })
  await tick()

  assert.equal(fakeStore.listenerCount(), 1)
  uninstall()
  assert.equal(fakeStore.listenerCount(), 0)

  fakeStore.setTheme('dark')
  await tick()

  assert.deepEqual(fake.preferences, ['light'])
})

test('with no bridge installation is a harmless no-op', () => {
  // A browser has no `window.x31deskDesktop`; installation must not throw and
  // must return a usable unsubscribe. A minimal window is enough for the lookup.
  const globals = globalThis as { window?: unknown }
  const previous = globals.window
  globals.window = {}

  try {
    const uninstall = installNativeThemeSource()

    assert.equal(typeof uninstall, 'function')
    uninstall()
  } finally {
    globals.window = previous
  }
})
