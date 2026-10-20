// The renderer's half of the close handshake, in isolation.
// ---------------------------------------------------------------------------
// `installCloseHandshake` subscribes to main's flush request through the
// lifecycle bridge, drains the save queue, and reports the result back. These
// tests drive it with a fake bridge and an injected flush, so the guarantees the
// shutdown path depends on are pinned without Electron or React:
//
//   * a successful flush answers `ok: true`; a failed one answers `ok: false`
//     (and reports the cause), never a claimed success;
//   * two requests that arrive before the first answer share one flush, and both
//     answers reflect it;
//   * a later request starts a fresh flush;
//   * unsubscribing stops the listener;
//   * in a browser (no bridge) installation is a harmless no-op.
//
// Dependency-free: Node's built-in test runner and type stripping.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { installCloseHandshake } from '@/data/closeHandshake'
import type { DesktopLifecycleBridge } from '@/types/desktop'

/** Lets the pending promise chains run before a test asserts. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** A fake lifecycle bridge the test can push a flush request through. */
function createBridge() {
  const handlers = new Set<() => void>()
  const reports: boolean[] = []

  const bridge: DesktopLifecycleBridge = {
    onFlushRequest: (handler) => {
      handlers.add(handler)

      return () => {
        handlers.delete(handler)
      }
    },
    reportFlushResult: async (report) => {
      reports.push(report.ok)
    },
  }

  return {
    bridge,
    reports,
    request() {
      for (const handler of [...handlers]) {
        handler()
      }
    },
    handlerCount: () => handlers.size,
  }
}

test('a successful flush is reported as ok:true', async () => {
  const fake = createBridge()
  let flushes = 0

  installCloseHandshake({
    bridge: fake.bridge,
    flush: async () => {
      flushes += 1
    },
  })

  fake.request()
  await tick()

  assert.equal(flushes, 1)
  assert.deepEqual(fake.reports, [true])
})

test('a failed flush is reported as ok:false and its cause is surfaced', async () => {
  const fake = createBridge()
  const failure = new Error('write failed')
  const errors: unknown[] = []

  installCloseHandshake({
    bridge: fake.bridge,
    flush: async () => {
      throw failure
    },
    onError: (error) => errors.push(error),
  })

  fake.request()
  await tick()

  assert.deepEqual(fake.reports, [false])
  assert.deepEqual(errors, [failure])
})

test('two requests before an answer share one flush, and both answers reflect it', async () => {
  const fake = createBridge()
  let flushes = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  installCloseHandshake({
    bridge: fake.bridge,
    flush: async () => {
      flushes += 1
      await gate
    },
  })

  fake.request()
  fake.request()

  assert.equal(flushes, 1)

  release()
  await tick()
  await tick()

  // One flush, two answers — both true.
  assert.deepEqual(fake.reports, [true, true])
})

test('a request after the handshake settled starts a fresh flush', async () => {
  const fake = createBridge()
  let flushes = 0

  installCloseHandshake({
    bridge: fake.bridge,
    flush: async () => {
      flushes += 1
    },
  })

  fake.request()
  await tick()
  fake.request()
  await tick()

  assert.equal(flushes, 2)
  assert.deepEqual(fake.reports, [true, true])
})

test('unsubscribing stops the listener', async () => {
  const fake = createBridge()
  let flushes = 0

  const uninstall = installCloseHandshake({
    bridge: fake.bridge,
    flush: async () => {
      flushes += 1
    },
  })

  assert.equal(fake.handlerCount(), 1)
  uninstall()
  assert.equal(fake.handlerCount(), 0)

  fake.request()
  await tick()

  assert.equal(flushes, 0)
  assert.deepEqual(fake.reports, [])
})

test('flushes the injected queue when no flush is given', async () => {
  const fake = createBridge()
  let flushed = 0

  installCloseHandshake({
    bridge: fake.bridge,
    queue: {
      schedule: () => {},
      flush: async () => {},
      flushAll: async () => {
        flushed += 1
      },
      cancel: () => {},
      cancelAll: () => {},
      hasScheduled: () => false,
      hasWork: () => false,
    },
  })

  fake.request()
  await tick()

  assert.equal(flushed, 1)
  assert.deepEqual(fake.reports, [true])
})

test('with no bridge the handshake is a harmless no-op', () => {
  // A browser has no `window.x31deskDesktop`; installation must not throw and
  // must return a usable unsubscribe. A minimal window is enough for the lookup.
  const globals = globalThis as { window?: unknown }
  const previous = globals.window
  globals.window = {}

  try {
    const uninstall = installCloseHandshake()

    assert.equal(typeof uninstall, 'function')
    uninstall()
  } finally {
    globals.window = previous
  }
})
