import type { ViewIntent } from '@/types/navigation'

/**
 * One-shot hand-off between views.
 *
 * Navigation is state-based, so a view cannot reach into another view's state to
 * say "and start a new note". Recording the intent beside the navigation model
 * lets the destination pick it up exactly once as it mounts, without threading
 * an extra prop through every page in the shell.
 *
 * Deliberately tiny and synchronous: an intent only has to survive the trip from
 * a click handler to the next view's mount effect.
 *
 * A destination that is *already* mounted cannot be reached by "it reads on
 * mount", so recording an intent also notifies any listener the view has
 * registered. That is what lets workspace search open an item while the user is
 * already in the item's workspace instead of leaving the request pending for the
 * next visit.
 */
let pending: ViewIntent | null = null

const listeners = new Set<() => void>()

/** Records what the destination view should do once it arrives. */
export function requestIntent(intent: ViewIntent): void {
  pending = intent

  for (const listener of listeners) {
    listener()
  }
}

/**
 * Registers a listener that fires whenever an intent is requested, and returns
 * the unsubscribe. The listener is expected to peek, claim an intent meant for
 * it and release it; intents for other views are left pending for their
 * destination.
 */
export function subscribeToIntents(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/**
 * Reads the recorded intent *without* releasing it.
 *
 * Non-mutating on purpose, so it is safe to call while rendering. That is what
 * lets a view already be in the requested state on its first paint — a create
 * form open, say — rather than opening it from an effect a commit later. Since a
 * render may be repeated, a reading call has to be repeatable too; the request
 * is released with `clearIntent` once the view has committed.
 */
export function peekIntent(): ViewIntent | null {
  return pending
}

/** Releases the recorded intent. Idempotent, so it is safe under StrictMode. */
export function clearIntent(): void {
  pending = null
}
