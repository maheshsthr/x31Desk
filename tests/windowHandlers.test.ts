// Focused tests for the main-process window-control handlers:
//   * each action performs exactly the window operation its name says —
//     minimize minimizes, toggle maximizes an ordinary window and restores a
//     maximized one, close *closes* (so the flush handshake runs);
//   * a channel that takes no arguments is rejected when it is handed one, and
//     a rejected call leaves the window untouched;
//   * the initial state read reports the window's real maximize state, and a
//     missing window is reported, never crashed on;
//   * registration publishes exactly the four invoke channels — the pushed
//     state channel is never handled;
//   * state publication sends the state the event carries, in both directions,
//     and stops when unsubscribed;
//   * `main.ts` really wires the frameless window, and the preload really
//     exposes the five-method `windowControls` group.
//
// These run under plain Node: `createWindowHandlers` takes its window through a
// provider and never imports Electron at runtime, so the handler logic is
// exercised against a plain object directly. Where the wiring itself is the
// subject (main entry, preload), the source is read and asserted, the way the
// repository handlers and the shutdown ordering already are.
//
// Dependency-free: Node's built-in test runner and type stripping.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { IPC_CHANNELS } from '@/data/ipc/contract'

import {
  createWindowHandlers,
  registerWindowHandlers,
  wireWindowState,
} from '../electron/ipc/windowHandlers.ts'

const at = (relative: string) => new URL(relative, import.meta.url)

/** A window stand-in that records operations, events and pushes. */
function createWindow(initialMaximized = false) {
  const calls: string[] = []
  const listeners = new Map<string, Set<() => void>>()
  const sent: Array<{ channel: string; payload: unknown }> = []
  let maximized = initialMaximized

  const window = {
    isMaximized: () => maximized,
    minimize: () => calls.push('minimize'),
    maximize: () => {
      calls.push('maximize')
      maximized = true
    },
    unmaximize: () => {
      calls.push('unmaximize')
      maximized = false
    },
    close: () => calls.push('close'),
    on: (event: string, listener: () => void) => {
      const set = listeners.get(event) ?? new Set<() => void>()
      set.add(listener)
      listeners.set(event, set)
    },
    removeListener: (event: string, listener: () => void) => {
      listeners.get(event)?.delete(listener)
    },
    webContents: {
      send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    },
  }

  return {
    window,
    calls,
    sent,
    /** Drives an event the way Electron would. */
    emit: (event: string) => {
      for (const listener of listeners.get(event) ?? []) {
        listener()
      }
    },
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
  }
}

test('each action performs exactly its own window operation', () => {
  const { window, calls } = createWindow()
  const handlers = createWindowHandlers(() => window)

  handlers.minimize([])
  assert.deepEqual(calls, ['minimize'])

  handlers.toggleMaximize([])
  assert.deepEqual(calls, ['minimize', 'maximize'], 'an ordinary window is maximized')

  handlers.toggleMaximize([])
  assert.deepEqual(calls, ['minimize', 'maximize', 'unmaximize'], 'a maximized window is restored')

  handlers.close([])
  assert.deepEqual(calls, ['minimize', 'maximize', 'unmaximize', 'close'])
})

test('a channel that takes no arguments rejects one, leaving the window alone', () => {
  const { window, calls } = createWindow()
  const handlers = createWindowHandlers(() => window)

  for (const handler of [handlers.minimize, handlers.toggleMaximize, handlers.close, handlers.getState]) {
    assert.throws(() => handler(['extra']), /does not accept arguments/)
  }

  assert.deepEqual(calls, [], 'a rejected call performs nothing')
})

test('the state read reports the window, and a missing window reports not maximized', () => {
  const { window } = createWindow(true)
  const handlers = createWindowHandlers(() => window)

  assert.deepEqual(handlers.getState([]), { maximized: true })

  // Between the window being closed and the renderer going away, the provider
  // can return nothing; every operation then stands down instead of throwing.
  const orphaned = createWindowHandlers(() => null)
  assert.deepEqual(orphaned.getState([]), { maximized: false })
  assert.doesNotThrow(() => orphaned.minimize([]))
  assert.doesNotThrow(() => orphaned.toggleMaximize([]))
  assert.doesNotThrow(() => orphaned.close([]))
})

test('registering publishes exactly the four invoke channels', () => {
  const registered = new Map<string, unknown>()
  const ipcMain = {
    handle: (channel: string, listener: unknown) => {
      registered.set(channel, listener)
    },
  }

  registerWindowHandlers(ipcMain, () => null)

  assert.deepEqual([...registered.keys()], [
    IPC_CHANNELS.windowMinimize,
    IPC_CHANNELS.windowToggleMaximize,
    IPC_CHANNELS.windowClose,
    IPC_CHANNELS.windowState,
  ])

  // The pushed channel must never appear as an `invoke` handler: nothing in
  // the renderer can call it, and the main process is the only sender.
  assert.equal(registered.has(IPC_CHANNELS.windowMaximizedChanged), false)
})

test('a registered listener forwards to the handler and returns its result', async () => {
  const { window } = createWindow(false)
  const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      registered.set(channel, listener)
    },
  }

  registerWindowHandlers(ipcMain, () => window)

  const stateListener = registered.get(IPC_CHANNELS.windowState)
  assert.ok(stateListener)
  assert.deepEqual(await stateListener(null), { maximized: false })

  const minimizeListener = registered.get(IPC_CHANNELS.windowMinimize)
  assert.ok(minimizeListener)
  assert.equal(await minimizeListener(null), undefined)

  // An argument is refused here too, which means it never reaches the window.
  assert.throws(() => registered.get(IPC_CHANNELS.windowClose)?.(null, 'extra'), /does not accept arguments/)
})

test('state publication pushes the value the event carries, in both directions', () => {
  const { window, sent, emit } = createWindow()
  const unsubscribe = wireWindowState(window)

  assert.equal(sent.length, 0, 'nothing is pushed until the state moves')

  window.maximize()
  emit('maximize')
  assert.deepEqual(sent.at(-1), {
    channel: IPC_CHANNELS.windowMaximizedChanged,
    payload: { maximized: true },
  })

  window.unmaximize()
  emit('unmaximize')
  assert.deepEqual(sent.at(-1), {
    channel: IPC_CHANNELS.windowMaximizedChanged,
    payload: { maximized: false },
  })

  unsubscribe()
})

test('unsubscribing stops the publication and detaches both listeners', () => {
  const { window, sent, emit, listenerCount } = createWindow()
  const unsubscribe = wireWindowState(window)

  assert.equal(listenerCount('maximize'), 1)
  assert.equal(listenerCount('unmaximize'), 1)

  unsubscribe()

  assert.equal(listenerCount('maximize'), 0)
  assert.equal(listenerCount('unmaximize'), 0)

  emit('maximize')
  assert.deepEqual(sent, [])
})

test('the main process creates a frameless window and wires its controls', () => {
  const source = readFileSync(at('../electron/main.ts'), 'utf8')

  assert.match(source, /frame: false/, 'the window must be frameless for the custom title bar')
  assert.doesNotMatch(
    source,
    /thickFrame:\s*false/,
    'thickFrame must keep its default, or edge resizing, shadow and snap are lost',
  )
  assert.match(source, /wireWindowState\(window\)/, 'the maximize-state push must be wired per window')
  assert.match(source, /registerWindowHandlers\(ipcMain/, 'the window-control channels must be registered')
})

test('the preload exposes exactly the windowControls surface', () => {
  const source = readFileSync(at('../electron/preload.ts'), 'utf8')

  assert.match(source, /windowControls: \{/)
  assert.match(source, /minimize: \(\) => ipcRenderer\.invoke\(IPC_CHANNELS\.windowMinimize\)/)
  assert.match(source, /toggleMaximize: \(\) => ipcRenderer\.invoke\(IPC_CHANNELS\.windowToggleMaximize\)/)
  assert.match(source, /close: \(\) => ipcRenderer\.invoke\(IPC_CHANNELS\.windowClose\)/)
  assert.match(source, /getState: \(\) => ipcRenderer\.invoke\(IPC_CHANNELS\.windowState\)/)
  assert.match(source, /onMaximizedChanged:/)
  assert.match(source, /IPC_CHANNELS\.windowMaximizedChanged/)
  assert.match(source, /removeListener\(/, 'the subscription must be revocable')
})
