/**
 * x31Desk — the renderer's half of the close handshake.
 * ---------------------------------------------------------------------------
 * The main process can close the window whenever it likes, but a debounced
 * draft may still be sitting in a timer. `beforeunload` is only a best-effort
 * hint — Chromium does not wait for asynchronous work in it, and a forced quit
 * may not fire it at all — so durability on the desktop is owned by an explicit
 * conversation instead:
 *
 *   1. Main intercepts the window's `close`, refuses to destroy the window and
 *      sends a flush request.
 *   2. This module receives it, calls `flushAll()` on the shared save queue and
 *      waits for every pending and in-flight write to settle.
 *   3. Only then does it answer — `ok: true` if everything settled, `ok: false`
 *      if a write failed. Main destroys the window on either answer, but it is
 *      never told a write succeeded that did not.
 *
 * The handshake is a no-op in a plain browser (there is no bridge), so the web
 * build keeps relying on `beforeunload` alone. Installation is idempotent per
 * subscriber and returns an unsubscribe, so a caller — or a test — can tear it
 * down.
 *
 * Concurrent requests share one flush: if main asks twice before the first
 * answer is sent, the renderer flushes once and both answers reflect it.
 */

import { saveQueue, type SaveQueue } from '@/data/saveQueue'
import type { DesktopLifecycleBridge } from '@/types/desktop'

/** Options for {@link installCloseHandshake}, all injectable for tests. */
export type CloseHandshakeOptions = {
  /** The bridge to use; defaults to `window.x31deskDesktop?.lifecycle`. */
  readonly bridge?: DesktopLifecycleBridge
  /** The flush to run; defaults to the shared queue's `flushAll`. */
  readonly flush?: () => Promise<void>
  /** The queue the default flush drains; defaults to the shared queue. */
  readonly queue?: SaveQueue
  /** Called when a flush throws, so a caller can log the cause. */
  readonly onError?: (error: unknown) => void
}

/** The lifecycle bridge, when the renderer is running inside Electron. */
function desktopLifecycle(): DesktopLifecycleBridge | undefined {
  return window.x31deskDesktop?.lifecycle
}

/**
 * Starts answering close-handshake flush requests and returns the unsubscribe.
 *
 * Returns a no-op unsubscribe in a browser, so a caller installs it
 * unconditionally.
 */
export function installCloseHandshake(options: CloseHandshakeOptions = {}): () => void {
  const bridge = options.bridge ?? desktopLifecycle()

  if (bridge === undefined) {
    return () => {}
  }

  const queue = options.queue ?? saveQueue
  const flush = options.flush ?? (() => queue.flushAll())

  // One flush in flight at a time. A second request joins the first rather than
  // starting a competing flush, and the slot clears once it settles.
  let inFlight: Promise<boolean> | null = null

  const runFlush = (): Promise<boolean> => {
    if (inFlight !== null) {
      return inFlight
    }

    const started = flush()
      .then(
        () => true,
        (error: unknown) => {
          options.onError?.(error)
          return false
        },
      )
      .finally(() => {
        inFlight = null
      })

    inFlight = started

    return started
  }

  return bridge.onFlushRequest(() => {
    // `runFlush` never rejects, so this chain only needs to swallow a rejected
    // report call (main may already have gone away).
    void runFlush()
      .then((ok) => bridge.reportFlushResult({ ok }))
      .catch(() => undefined)
  })
}
