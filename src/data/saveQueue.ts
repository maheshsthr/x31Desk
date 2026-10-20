/**
 * x31Desk — the draft save queue.
 * ---------------------------------------------------------------------------
 * The notes and snippets workspaces write on a short debounce so a burst of
 * keystrokes becomes one write. That design has three hazards the naive
 * `setTimeout` + `pendingRef` pattern did not handle, and this module is the one
 * place they are solved:
 *
 *   * **A later edit must not be lost while an earlier save runs.** Storage is
 *     asynchronous by contract, so a write can still be in flight when the next
 *     keystroke arrives. The queue keeps the *latest* scheduled write per record
 *     and serializes writes to that record: a newer draft replaces an unstarted
 *     one, and a draft that arrives during a write is run immediately after it.
 *   * **A flush must be awaitable.** Before archiving, deleting or shutting
 *     down, the caller has to know that every pending and in-flight write has
 *     settled — not merely that a timer was cleared. `flush(id)` and
 *     `flushAll()` await exactly that.
 *   * **A cancelled write must never run.** Deleting or clearing a record
 *     cancels its queued write first, so a debounced save can never resurrect a
 *     record a moment after it is gone.
 *
 * The queue is deliberately framework-free: it knows nothing about React, the
 * repositories or records, only "an id and a function that writes it". The hooks
 * translate their editors onto it, and the tests drive it directly.
 *
 * Timers are injected so a test can run the debounce deterministically instead
 * of sleeping; production uses `globalThis`.
 */

/** The scheduler the queue debounces with. Injected so tests can control time. */
export type SaveQueueClock = {
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (handle: number) => void
}

const defaultClock: SaveQueueClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs) as unknown as number,
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
}

/** One record's slot: its debounce timer, its latest unstarted write and its run. */
type SaveEntry = {
  timer: number | null
  /** The latest scheduled write, or `null` once it has started. */
  pending: (() => Promise<void>) | null
  /** The write currently draining, or `null` when the slot is idle. */
  active: Promise<void> | null
}

/** The per-record save coordinator described in the module header. */
export type SaveQueue = {
  /**
   * Registers `run` as the latest write for `id`, (re)starting the debounce.
   * A newer call for the same id replaces an unstarted one, so only the latest
   * draft is written.
   */
  schedule: (id: string, delayMs: number, run: () => Promise<void>) => void
  /**
   * Writes `id` now and resolves once it — and any newer draft scheduled while
   * it ran — has settled. Rejects if a write failed.
   */
  flush: (id: string) => Promise<void>
  /**
   * Writes every queued record and resolves once all of them have settled.
   * Rejects if any write failed, after waiting for the rest.
   */
  flushAll: () => Promise<void>
  /** Drops an unstarted write for `id`; a write already in flight still finishes. */
  cancel: (id: string) => void
  /** Drops every unstarted write. In-flight writes still finish. */
  cancelAll: () => void
  /** Whether `id` has work that has not started yet (a timer or a draft). */
  hasScheduled: (id: string) => boolean
  /** Whether any record has a timer, a draft or a write in flight. */
  hasWork: () => boolean
}

/**
 * Builds a save queue. Each record id is independent, so a slow write for one
 * note never delays another; `flushAll` is how a caller waits for all of them.
 */
export function createSaveQueue(clock: SaveQueueClock = defaultClock): SaveQueue {
  const entries = new Map<string, SaveEntry>()

  function entryFor(id: string): SaveEntry {
    let entry = entries.get(id)

    if (entry === undefined) {
      entry = { timer: null, pending: null, active: null }
      entries.set(id, entry)
    }

    return entry
  }

  /** Removes an entry once it has nothing left to do, so the map cannot grow. */
  function forgetIfIdle(id: string, entry: SaveEntry): void {
    if (entry.timer === null && entry.pending === null && entry.active === null) {
      entries.delete(id)
    }
  }

  function clearTimer(entry: SaveEntry): void {
    if (entry.timer !== null) {
      clock.clearTimeout(entry.timer)
      entry.timer = null
    }
  }

  /**
   * Starts draining `id`, or joins the drain already running.
   *
   * The loop re-reads `entry.pending` after every write, so a draft that arrived
   * while the previous one was in flight is picked up rather than stranded.
   * Failures are remembered and rethrown once the queue has drained, so a newer
   * draft is still attempted and `flush` can report the failure it saw.
   */
  function start(id: string, entry: SaveEntry): Promise<void> {
    if (entry.active !== null) {
      return entry.active
    }

    if (entry.pending === null) {
      return Promise.resolve()
    }

    const active = (async () => {
      let firstError: unknown = null

      try {
        while (entry.pending !== null) {
          const run = entry.pending
          entry.pending = null

          try {
            await run()
          } catch (error) {
            firstError ??= error
          }
        }

        if (firstError !== null) {
          throw firstError
        }
      } finally {
        entry.active = null
        forgetIfIdle(id, entry)
      }
    })()

    entry.active = active

    return active
  }

  async function flush(id: string): Promise<void> {
    const entry = entries.get(id)

    if (entry === undefined) {
      return
    }

    // Firing the debounce early is how a flush beats the timer; there is no
    // reason to wait out a delay the caller has asked to skip.
    clearTimer(entry)

    while (entry.pending !== null || entry.active !== null) {
      if (entry.active === null) {
        start(id, entry)
      }

      await entry.active
    }

    forgetIfIdle(id, entry)
  }

  return {
    schedule(id, delayMs, run) {
      const entry = entryFor(id)

      entry.pending = run
      clearTimer(entry)
      entry.timer = clock.setTimeout(() => {
        entry.timer = null
        // The scheduled path reports its failure through the caller that owns
        // the write; a rejection here must not become an unhandled one.
        void start(id, entry).catch(() => undefined)
      }, delayMs)
    },

    flush,

    async flushAll() {
      // Loop rather than snapshot once: a write completing can reveal another
      // entry (a record touched while flushing), and only an empty queue is a
      // settled one.
      for (;;) {
        const ids = [...entries.keys()]

        if (ids.length === 0) {
          return
        }

        const results = await Promise.allSettled(ids.map((id) => flush(id)))
        const failed = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        )

        if (failed !== undefined) {
          throw failed.reason
        }
      }
    },

    cancel(id) {
      const entry = entries.get(id)

      if (entry === undefined) {
        return
      }

      clearTimer(entry)
      entry.pending = null
      forgetIfIdle(id, entry)
    },

    cancelAll() {
      for (const [id, entry] of entries) {
        clearTimer(entry)
        entry.pending = null
        forgetIfIdle(id, entry)
      }
    },

    hasScheduled(id) {
      const entry = entries.get(id)

      return entry !== undefined && (entry.timer !== null || entry.pending !== null)
    },

    hasWork() {
      return entries.size > 0
    },
  }
}

/**
 * The application's shared queue.
 *
 * One queue for the whole renderer, so a shutdown flush sees every workspace at
 * once and a key can be addressed from anywhere. Records are namespaced by their
 * workspace (`note:<id>`, `snippet:<id>`) so two collections can never collide.
 */
export const saveQueue: SaveQueue = createSaveQueue()
