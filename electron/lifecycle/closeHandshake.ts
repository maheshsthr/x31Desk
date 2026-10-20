/**
 * x31Desk — the main process's close-handshake state machine.
 * ---------------------------------------------------------------------------
 * Electron destroys a window the moment it is allowed to close. This module
 * inserts a bounded, explicit pause in front of that: on the first close request
 * it asks the renderer to flush and waits for an answer, then lets the window go
 * — or gives up after a timeout. It is a plain object with injected side effects
 * and timers, so its state machine can be driven deterministically in a test
 * without Electron or a real window.
 *
 * The rules it exists to enforce:
 *
 *   * **Answer once.** `terminate` is called exactly once, whatever happens —
 *     a flush answer, a timeout, or the renderer vanishing.
 *   * **Repeated requests are idempotent.** A second close while a flush is in
 *     flight does not start a second one; a close after the handshake settled is
 *     not held back.
 *   * **A timeout is not a success.** A flush that never answers, or that
 *     reports a failure, terminates the same way — main simply stops waiting. It
 *     never claims the renderer's writes succeeded.
 */

import type { FlushReport } from '@/data/ipc/contract'

/** Why the window was allowed to close, and whether the flush succeeded. */
export type CloseOutcome =
  | { readonly reason: 'flushed'; readonly ok: boolean }
  | { readonly reason: 'timeout' }
  | { readonly reason: 'unavailable' }

/** How long main waits for the renderer before closing anyway. */
export const DEFAULT_FLUSH_TIMEOUT_MS = 5000

/** The side effects and clock the handshake drives. All injectable for tests. */
export type CloseHandshakeDeps = {
  /** Asks the renderer to flush. May throw if the renderer is already gone. */
  readonly requestFlush: () => void
  /** Destroys the window. Called exactly once, from any terminal path. */
  readonly terminate: (outcome: CloseOutcome) => void
  /** How long to wait for an answer. Defaults to {@link DEFAULT_FLUSH_TIMEOUT_MS}. */
  readonly timeoutMs?: number
  /** Schedules the timeout. Defaults to `globalThis.setTimeout`. */
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown
  /** Cancels the timeout. Defaults to `globalThis.clearTimeout`. */
  readonly clearTimer?: (handle: unknown) => void
}

/** The handshake handle the window's `close` handler drives. */
export type CloseHandshake = {
  /**
   * Starts the flush-and-wait, or does nothing if it has already started or
   * finished. Safe to call on every close request.
   */
  readonly begin: () => void
  /** Records the renderer's answer. Ignored unless a flush is in flight. */
  readonly complete: (report: FlushReport) => void
  /** Gives up early — the renderer crashed or was destroyed. */
  readonly abort: () => void
  /** Whether a flush is in flight (the window must not be closed yet). */
  readonly isWaiting: () => boolean
  /** Whether the handshake has settled and the window may close. */
  readonly isSettled: () => boolean
}

/** Builds a handshake over the given side effects. */
export function createCloseHandshake(deps: CloseHandshakeDeps): CloseHandshake {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS
  const setTimer = deps.setTimer ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs))
  const clearTimer = deps.clearTimer ?? ((handle) => globalThis.clearTimeout(handle as number))

  let state: 'idle' | 'waiting' | 'settled' = 'idle'
  let timer: unknown = null

  /** Ends the handshake, invoking `terminate` exactly once. */
  function settle(outcome: CloseOutcome): void {
    if (state === 'settled') {
      return
    }

    state = 'settled'

    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }

    deps.terminate(outcome)
  }

  return {
    begin() {
      // Already flushing or already done: a repeated close request changes
      // nothing, so a double-click on the title-bar button cannot start two.
      if (state !== 'idle') {
        return
      }

      state = 'waiting'

      try {
        deps.requestFlush()
      } catch {
        // There is no renderer to answer, so there is nothing to wait for.
        settle({ reason: 'unavailable' })
        return
      }

      timer = setTimer(() => settle({ reason: 'timeout' }), timeoutMs)
    },

    complete(report) {
      if (state !== 'waiting') {
        return
      }

      settle({ reason: 'flushed', ok: report.ok })
    },

    abort() {
      if (state !== 'waiting') {
        return
      }

      settle({ reason: 'unavailable' })
    },

    isWaiting() {
      return state === 'waiting'
    },

    isSettled() {
      return state === 'settled'
    },
  }
}
