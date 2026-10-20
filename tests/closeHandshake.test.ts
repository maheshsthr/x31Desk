// The main process's close-handshake state machine, in isolation.
// ---------------------------------------------------------------------------
// `createCloseHandshake` is a plain object over injected side effects and timers,
// so the whole state machine can be driven without Electron or a real window.
// These tests pin the guarantees the shutdown path depends on:
//
//   * `terminate` is called exactly once, from every terminal path;
//   * a repeated close while a flush is in flight does not start a second one,
//     and a close after the handshake settled is not held back;
//   * a timeout and a renderer that vanished both terminate — and never look
//     like a successful flush;
//   * a request that throws (the renderer is already gone) does not deadlock;
//   * the renderer's answer is accepted only when it is a genuine boolean, so a
//     malformed payload is never mistaken for a successful flush.
//
// Dependency-free: Node's built-in test runner and type stripping.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createCloseHandshake,
  DEFAULT_FLUSH_TIMEOUT_MS,
  type CloseOutcome,
} from '../electron/lifecycle/closeHandshake.ts'
import { parseFlushReport } from '../electron/ipc/validation.ts'

/** Builds a handshake whose timers and side effects the test controls. */
function createController(options: { requestThrows?: boolean } = {}) {
  const outcomes: CloseOutcome[] = []
  let requests = 0
  let clearCount = 0
  let timeoutCallback: (() => void) | null = null
  let timeoutDelay: number | null = null

  const handshake = createCloseHandshake({
    requestFlush: () => {
      requests += 1

      if (options.requestThrows) {
        throw new Error('renderer is gone')
      }
    },
    terminate: (outcome) => {
      outcomes.push(outcome)
    },
    timeoutMs: 1234,
    setTimer: (callback, delayMs) => {
      timeoutCallback = callback
      timeoutDelay = delayMs

      return 'handle'
    },
    clearTimer: () => {
      clearCount += 1
      timeoutCallback = null
    },
  })

  return {
    handshake,
    outcomes,
    requests: () => requests,
    clearCount: () => clearCount,
    timeoutDelay: () => timeoutDelay,
    fireTimeout: () => {
      const callback = timeoutCallback
      timeoutCallback = null
      callback?.()
    },
  }
}

test('begin asks the renderer to flush and waits', () => {
  const controller = createController()

  controller.handshake.begin()

  assert.equal(controller.requests(), 1)
  assert.equal(controller.handshake.isWaiting(), true)
  assert.equal(controller.handshake.isSettled(), false)
  assert.equal(controller.outcomes.length, 0)
  assert.equal(controller.timeoutDelay(), 1234)
})

test('a successful flush answer terminates with ok:true, once', () => {
  const controller = createController()

  controller.handshake.begin()
  controller.handshake.complete({ ok: true })

  assert.deepEqual(controller.outcomes, [{ reason: 'flushed', ok: true }])
  assert.equal(controller.handshake.isWaiting(), false)
  assert.equal(controller.handshake.isSettled(), true)
  // The pending timeout was cancelled once the answer arrived.
  assert.equal(controller.clearCount(), 1)

  // A second answer, or a second begin, changes nothing.
  controller.handshake.complete({ ok: true })
  controller.handshake.begin()
  assert.equal(controller.outcomes.length, 1)
})

test('a failed flush answer terminates with ok:false, never a claimed success', () => {
  const controller = createController()

  controller.handshake.begin()
  controller.handshake.complete({ ok: false })

  assert.deepEqual(controller.outcomes, [{ reason: 'flushed', ok: false }])
})

test('a repeated begin while waiting does not start a second flush', () => {
  const controller = createController()

  controller.handshake.begin()
  controller.handshake.begin()
  controller.handshake.begin()

  assert.equal(controller.requests(), 1)
  assert.equal(controller.handshake.isWaiting(), true)
})

test('a timeout terminates once, and is not a success', () => {
  const controller = createController()

  controller.handshake.begin()
  controller.fireTimeout()

  assert.deepEqual(controller.outcomes, [{ reason: 'timeout' }])
  assert.equal(controller.handshake.isSettled(), true)

  // A late answer after the timeout is ignored.
  controller.handshake.complete({ ok: true })
  assert.equal(controller.outcomes.length, 1)
})

test('aborting (renderer crashed) terminates as unavailable', () => {
  const controller = createController()

  controller.handshake.begin()
  controller.handshake.abort()

  assert.deepEqual(controller.outcomes, [{ reason: 'unavailable' }])
  assert.equal(controller.handshake.isSettled(), true)
})

test('abort while idle is a no-op', () => {
  const controller = createController()

  controller.handshake.abort()

  assert.deepEqual(controller.outcomes, [])
  assert.equal(controller.handshake.isSettled(), false)
})

test('a request that throws terminates immediately, without waiting', () => {
  const controller = createController({ requestThrows: true })

  controller.handshake.begin()

  assert.equal(controller.requests(), 1)
  assert.deepEqual(controller.outcomes, [{ reason: 'unavailable' }])
  assert.equal(controller.handshake.isWaiting(), false)
  assert.equal(controller.handshake.isSettled(), true)
  // No timer was ever armed, so none needs cancelling.
  assert.equal(controller.timeoutDelay(), null)
})

test('complete while idle is ignored', () => {
  const controller = createController()

  controller.handshake.complete({ ok: true })

  assert.deepEqual(controller.outcomes, [])
  assert.equal(controller.handshake.isSettled(), false)
})

test('the default timeout is the documented five seconds', () => {
  assert.equal(DEFAULT_FLUSH_TIMEOUT_MS, 5000)
})

// ---------------------------------------------------------------------------
// The renderer's answer, as the main process parses it.
// ---------------------------------------------------------------------------

test('a genuine boolean answer is accepted, either way', () => {
  assert.deepEqual(parseFlushReport({ ok: true }), { ok: true })
  assert.deepEqual(parseFlushReport({ ok: false }), { ok: false })
})

test('a malformed or missing answer is not confirmed, never a claimed success', () => {
  // Anything that is not a literal boolean `ok` parses to `null`, which the
  // handler turns into `{ ok: false }` — so a bad payload can never read as a
  // successful flush.
  for (const value of [
    undefined,
    null,
    {},
    { ok: 'true' },
    { ok: 1 },
    { ok: 0 },
    { ok: null },
    { ok: undefined },
    true,
    false,
    'ok',
    0,
    [],
  ]) {
    assert.equal(parseFlushReport(value), null, `expected ${JSON.stringify(value)} to be rejected`)
  }
})

test('extra fields are ignored rather than trusted', () => {
  assert.deepEqual(parseFlushReport({ ok: true, extra: 'ignored' }), { ok: true })
})
