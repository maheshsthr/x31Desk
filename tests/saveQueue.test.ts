// The draft save queue, in isolation.
// ---------------------------------------------------------------------------
// The queue is what makes a debounced write safe: it keeps the *latest* draft
// per record, serializes writes to that record, and exposes an awaitable flush.
// These tests drive its timer directly through an injected clock, so they assert
// the exact ordering rather than racing a real one. They pin:
//
//   * a debounced write runs once, after the delay, and a newer draft replaces
//     an unstarted one;
//   * a draft that arrives while an earlier write is in flight is not lost, and
//     still runs — with the newer content — after it;
//   * `flush`/`flushAll` await pending timers and every in-flight write, and
//     reject when a write failed;
//   * a cancelled write never runs, so it cannot resurrect a deleted record.
//
// Dependency-free: Node's built-in test runner and type stripping.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSaveQueue, type SaveQueueClock } from '@/data/saveQueue'

/** A clock whose time only advances when the test says so. */
function createManualClock() {
  let nextHandle = 1
  let now = 0
  const timers = new Map<number, { callback: () => void; at: number }>()

  const clock: SaveQueueClock = {
    setTimeout: (callback, delayMs) => {
      const handle = nextHandle
      nextHandle += 1
      timers.set(handle, { callback, at: now + delayMs })
      return handle
    },
    clearTimeout: (handle) => {
      timers.delete(handle)
    },
  }

  return {
    clock,
    advance(ms: number) {
      now += ms

      for (const [handle, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(handle)
          timer.callback()
        }
      }
    },
    pendingTimers: () => timers.size,
  }
}

/** A promise the test resolves by hand, to keep a write in flight. */
function createDeferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

test('a debounced write runs once, after the delay', async () => {
  const { clock, advance, pendingTimers } = createManualClock()
  const queue = createSaveQueue(clock)
  let calls = 0

  queue.schedule('note:a', 500, async () => {
    calls += 1
  })

  assert.equal(calls, 0)

  advance(499)
  assert.equal(calls, 0)

  advance(1)
  assert.equal(calls, 1)
  assert.equal(pendingTimers(), 0)

  await queue.flushAll()
  assert.equal(queue.hasWork(), false)
})

test('a newer draft replaces an unstarted one', async () => {
  const { clock, advance } = createManualClock()
  const queue = createSaveQueue(clock)
  const order: string[] = []

  queue.schedule('note:a', 500, async () => {
    order.push('first')
  })
  queue.schedule('note:a', 500, async () => {
    order.push('second')
  })

  advance(500)

  assert.deepEqual(order, ['second'])
  await queue.flushAll()
})

test('flush writes a pending draft early and awaits it', async () => {
  const { clock } = createManualClock()
  const queue = createSaveQueue(clock)
  let calls = 0

  queue.schedule('note:a', 500, async () => {
    calls += 1
  })

  await queue.flush('note:a')

  assert.equal(calls, 1)
  assert.equal(queue.hasWork(), false)
})

test('a draft that arrives mid-write runs after it, with the latest content', async () => {
  const { clock, advance } = createManualClock()
  const queue = createSaveQueue(clock)
  const order: string[] = []
  const inFlight = createDeferred()

  queue.schedule('note:a', 500, async () => {
    order.push('first:start')
    await inFlight.promise
    order.push('first:end')
  })

  advance(500)
  assert.deepEqual(order, ['first:start'])

  // A newer keystroke lands while the first write is still awaiting storage.
  queue.schedule('note:a', 500, async () => {
    order.push('second')
  })

  const flushed = queue.flush('note:a')
  inFlight.resolve()
  await flushed

  assert.deepEqual(order, ['first:start', 'first:end', 'second'])
  assert.equal(queue.hasWork(), false)
})

test('flush rejects when a write failed, and a later write can still succeed', async () => {
  const { clock } = createManualClock()
  const queue = createSaveQueue(clock)
  const failure = new Error('storage unavailable')

  queue.schedule('note:a', 500, async () => {
    throw failure
  })

  await assert.rejects(queue.flush('note:a'), failure)

  let succeeded = false
  queue.schedule('note:a', 500, async () => {
    succeeded = true
  })

  await queue.flush('note:a')
  assert.equal(succeeded, true)
})

test('a failure is remembered while newer drafts are still drained', async () => {
  const { clock } = createManualClock()
  const queue = createSaveQueue(clock)
  const attempted: string[] = []

  // The first write fails; a newer one queued during it must still be tried.
  queue.schedule('note:a', 500, async () => {
    attempted.push('first')
    throw new Error('boom')
  })

  const flushed = queue.flush('note:a')

  queue.schedule('note:a', 500, async () => {
    attempted.push('second')
  })

  await assert.rejects(flushed)
  assert.deepEqual(attempted, ['first', 'second'])
})

test('flushAll waits for every in-flight write before it resolves', async () => {
  const { clock, advance } = createManualClock()
  const queue = createSaveQueue(clock)
  const first = createDeferred()
  const second = createDeferred()
  const started: string[] = []

  queue.schedule('note:a', 500, async () => {
    started.push('a')
    await first.promise
  })
  queue.schedule('snippet:b', 500, async () => {
    started.push('b')
    await second.promise
  })

  advance(500)
  assert.deepEqual([...started].sort(), ['a', 'b'])

  let settled = false
  const all = queue.flushAll().then(() => {
    settled = true
  })

  await Promise.resolve()
  assert.equal(settled, false)

  first.resolve()
  second.resolve()
  await all

  assert.equal(settled, true)
  assert.equal(queue.hasWork(), false)
})

test('cancel drops an unstarted write so it never runs', async () => {
  const { clock, advance } = createManualClock()
  const queue = createSaveQueue(clock)
  let calls = 0

  queue.schedule('note:a', 500, async () => {
    calls += 1
  })
  queue.cancel('note:a')

  advance(1000)
  await queue.flush('note:a')

  assert.equal(calls, 0)
})

test('cancelAll drops every unstarted write', async () => {
  const { clock, advance } = createManualClock()
  const queue = createSaveQueue(clock)
  let calls = 0

  queue.schedule('note:a', 500, async () => {
    calls += 1
  })
  queue.schedule('snippet:b', 500, async () => {
    calls += 1
  })

  queue.cancelAll()
  advance(1000)
  await queue.flushAll()

  assert.equal(calls, 0)
  assert.equal(queue.hasWork(), false)
})

test('hasScheduled reports a queued draft but not a running write', async () => {
  const { clock, advance } = createManualClock()
  const queue = createSaveQueue(clock)
  const inFlight = createDeferred()

  queue.schedule('note:a', 500, async () => {
    await inFlight.promise
  })

  assert.equal(queue.hasScheduled('note:a'), true)
  assert.equal(queue.hasScheduled('note:b'), false)

  advance(500)
  assert.equal(queue.hasScheduled('note:a'), false)

  inFlight.resolve()
  await queue.flushAll()
})
