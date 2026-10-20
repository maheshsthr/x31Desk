// Focused tests for the main-process native-chrome theme handler:
//   * a valid preference is written straight onto `nativeTheme.themeSource`;
//   * a missing, extra or malformed argument is rejected and the native theme is
//     left exactly as it was, never set to an arbitrary value;
//   * registration publishes exactly the one theme channel.
//
// These run under plain Node: `createThemeHandlers` takes its native theme as a
// parameter and never imports Electron at runtime, so the handler logic is
// exercised against a plain object directly.
//
// Dependency-free: Node's built-in test runner and type stripping.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { IPC_CHANNELS } from '@/data/ipc/contract'

import {
  createThemeHandlers,
  registerThemeHandlers,
  type NativeThemeSource,
} from '../electron/ipc/themeHandlers.ts'

/** A stand-in native theme the test can inspect after a call. */
function createNativeTheme(initial: NativeThemeSource['themeSource'] = 'system') {
  const nativeTheme: NativeThemeSource = { themeSource: initial }

  return nativeTheme
}

const INVALID = { ok: false, kind: 'unknown' }

test('a valid preference is written onto the native theme source', () => {
  const nativeTheme = createNativeTheme('system')
  const handlers = createThemeHandlers(nativeTheme)

  assert.deepEqual(handlers.setSource([{ preference: 'dark' }]), { ok: true, value: undefined })
  assert.equal(nativeTheme.themeSource, 'dark')

  assert.deepEqual(handlers.setSource([{ preference: 'light' }]), { ok: true, value: undefined })
  assert.equal(nativeTheme.themeSource, 'light')

  // `system` is a real value here: it hands the decision back to the OS.
  assert.deepEqual(handlers.setSource([{ preference: 'system' }]), { ok: true, value: undefined })
  assert.equal(nativeTheme.themeSource, 'system')
})

test('a channel that takes exactly one argument rejects none or an extra one', () => {
  const nativeTheme = createNativeTheme('light')
  const handlers = createThemeHandlers(nativeTheme)

  assert.deepEqual(handlers.setSource([]), INVALID)
  assert.deepEqual(handlers.setSource([{ preference: 'dark' }, 'extra']), INVALID)

  // Nothing was written by a rejected call.
  assert.equal(nativeTheme.themeSource, 'light')
})

test('a malformed payload is rejected before the native theme is touched', () => {
  const nativeTheme = createNativeTheme('light')
  const handlers = createThemeHandlers(nativeTheme)

  // An unknown preference, a wrong type, a bare string and `null` are all
  // refused, so `themeSource` can never be set to something Electron rejects.
  assert.deepEqual(handlers.setSource([{ preference: 'midnight' }]), INVALID)
  assert.deepEqual(handlers.setSource([{ preference: 42 }]), INVALID)
  assert.deepEqual(handlers.setSource(['dark']), INVALID)
  assert.deepEqual(handlers.setSource([null]), INVALID)
  assert.deepEqual(handlers.setSource([{ theme: 'dark' }]), INVALID)

  assert.equal(nativeTheme.themeSource, 'light')
})

test('registering publishes exactly the theme channel', () => {
  const registered = new Map<string, unknown>()
  const ipcMain = {
    handle: (channel: string, listener: unknown) => {
      registered.set(channel, listener)
    },
  }

  registerThemeHandlers(ipcMain, createNativeTheme())

  assert.deepEqual([...registered.keys()], [IPC_CHANNELS.themeSetSource])
})

test('a registered listener forwards its arguments to the handler', async () => {
  const nativeTheme = createNativeTheme('system')
  const registered = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
  const ipcMain = {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      registered.set(channel, listener)
    },
  }

  registerThemeHandlers(ipcMain, nativeTheme)

  const listener = registered.get(IPC_CHANNELS.themeSetSource)
  assert.ok(listener)

  assert.deepEqual(await listener(null, { preference: 'dark' }), { ok: true, value: undefined })
  assert.equal(nativeTheme.themeSource, 'dark')
})
