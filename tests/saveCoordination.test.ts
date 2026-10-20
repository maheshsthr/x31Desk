// Coordination between the debounced save queue and destructive actions.
// ---------------------------------------------------------------------------
// The queue alone is tested in `saveQueue.test.ts`. What this file pins is the
// *policy* the workspaces build on top of it, against a fake repository:
//
//   * deleting a record cancels its queued write and waits out any write already
//     in flight, so a debounced save can never resurrect it;
//   * archiving flushes the latest draft first (without cancelling), reads the
//     record back, and only then moves it — so the archived copy is the newest;
//   * clearing the workspace drops every queued write before it wipes, so
//     nothing is written back after the reset.
//
// The flows mirror `useNotes`/`useSnippets` and `clearWorkspaceData` exactly, but
// against an in-memory map rather than `localStorage`, so the assertion is about
// ordering and resurrection, not about a storage adapter.
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
  }
}

/** A promise the test resolves by hand, to keep a write in flight. */
function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })

  return { promise, resolve }
}

/** An in-memory stand-in for a repository, recording every write. */
function createRepository() {
  const records = new Map<string, string>()
  const writes: string[] = []

  return {
    records,
    writes,
    async write(id: string, value: string) {
      writes.push(`${id}=${value}`)
      records.set(id, value)
    },
    async remove(id: string) {
      records.delete(id)
    },
    has: (id: string) => records.has(id),
  }
}

test('deleting a record cancels its pending write, so it is not resurrected', async () => {
  const { clock, advance } = createManualClock()
  const queue = createSaveQueue(clock)
  const repository = createRepository()

  // A debounced edit...
  queue.schedule('note:a', 500, () => repository.write('a', 'draft'))

  // ...then a delete before the debounce fires.
  queue.cancel('note:a')
  await queue.flush('note:a')
  await repository.remove('a')

  // Long past the debounce: the cancelled write must not run.
  advance(5000)

  assert.equal(repository.has('a'), false)
  assert.deepEqual(repository.writes, [])
})

test('deleting waits for a write already in flight before removing', async () => {
  const { clock, advance } = createManualClock()
  const queue = createSaveQueue(clock)
  const repository = createRepository()
  const inFlight = createDeferred()

  queue.schedule('note:a', 500, async () => {
    await inFlight.promise
    await repository.write('a', 'latest')
  })

  advance(500)

  const deleting = (async () => {
    queue.cancel('note:a')
    await queue.flush('note:a')
    await repository.remove('a')
  })()

  inFlight.resolve()
  await deleting

  assert.equal(repository.has('a'), false)
  // The in-flight write did run, and the delete happened after it.
  assert.deepEqual(repository.writes, ['a=latest'])
})

test('archiving flushes the latest draft first, then reads it back', async () => {
  const { clock } = createManualClock()
  const queue = createSaveQueue(clock)
  const repository = createRepository()

  // A pending edit that the in-memory list has not seen yet.
  queue.schedule('snippet:s', 500, () => repository.write('s', 'newest'))

  const archived = (async () => {
    // Flush (do not cancel) so the latest draft is persisted, then read back.
    await queue.flush('snippet:s')
    const value = repository.records.get('s') ?? null
    queue.cancel('snippet:s')
    await repository.remove('s')
    return value
  })()

  assert.equal(await archived, 'newest')
  assert.equal(repository.has('s'), false)
  assert.deepEqual(repository.writes, ['s=newest'])
})

test('a draft that lands during an archive is still the one archived', async () => {
  const { clock, advance } = createManualClock()
  const queue = createSaveQueue(clock)
  const repository = createRepository()
  const firstInFlight = createDeferred()

  queue.schedule('snippet:s', 500, async () => {
    await firstInFlight.promise
    await repository.write('s', 'first')
  })

  advance(500)

  const archived = (async () => {
    const flushing = queue.flush('snippet:s')

    // A keystroke arrives while the first write is still awaiting storage; it
    // replaces the pending draft and is written by the same flush.
    queue.schedule('snippet:s', 500, () => repository.write('s', 'second'))

    await flushing
    const value = repository.records.get('s') ?? null
    queue.cancel('snippet:s')
    await repository.remove('s')
    return value
  })()

  firstInFlight.resolve()

  assert.equal(await archived, 'second')
  assert.deepEqual(repository.writes, ['s=first', 's=second'])
})

test('clearing drops queued writes before wiping, so nothing is written back', async () => {
  const { clock, advance } = createManualClock()
  const queue = createSaveQueue(clock)
  const repository = createRepository()

  queue.schedule('note:a', 500, () => repository.write('a', 'x'))
  queue.schedule('snippet:b', 500, () => repository.write('b', 'y'))

  // `clearWorkspaceData`: cancel everything, await any in-flight write, clear.
  queue.cancelAll()
  await queue.flushAll().catch(() => undefined)
  await repository.remove('a')
  await repository.remove('b')

  advance(5000)

  assert.equal(repository.records.size, 0)
  assert.deepEqual(repository.writes, [])
  assert.equal(queue.hasWork(), false)
})

test('clearing waits for an in-flight write before wiping', async () => {
  const { clock, advance } = createManualClock()
  const queue = createSaveQueue(clock)
  const repository = createRepository()
  const inFlight = createDeferred()

  queue.schedule('note:a', 500, async () => {
    await inFlight.promise
    await repository.write('a', 'late')
  })

  advance(500)

  const clearing = (async () => {
    queue.cancelAll()
    await queue.flushAll().catch(() => undefined)
    await repository.remove('a')
  })()

  inFlight.resolve()
  await clearing

  assert.equal(repository.has('a'), false)
  // The in-flight write landed, then the wipe removed it — order guaranteed.
  assert.deepEqual(repository.writes, ['a=late'])
})
