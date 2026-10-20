import { STORAGE_KEYS } from '@/data/storageKeys'

/**
 * Cross-tab change notification.
 * ---------------------------------------------------------------------------
 * The workspace lives in `localStorage`, and the browser fires a `storage` event
 * in every *other* same-origin document whenever one of those values changes.
 * That is the whole mechanism: the tab that writes never hears its own event, so
 * there is no echo to suppress and no way for a refresh to feed itself; and a
 * tab that hears an event can re-read and fold in whatever the other tab did.
 *
 * This module is the only place that listens. It exposes a key-filtered
 * subscription, so each store and hook watches exactly the key it owns and a
 * change to one collection never wakes the others.
 *
 * A refresh only ever *reads* and republishes; it never writes. Combined with
 * the fact that `storage` does not fire in the originating tab, that rules out
 * both infinite loops and duplicate notifications.
 *
 * The listener degrades to a no-op wherever the API is missing (a non-DOM test
 * process, a hardened browser), so every caller can subscribe unconditionally.
 *
 * `BroadcastChannel` is deliberately not used. The state already lives in
 * `localStorage`, whose built-in event carries the change with no second channel
 * to keep in step — and therefore no chance of the same change being announced
 * twice, once on each channel.
 */

/** The four record collections, for watchers that care about all workspace data. */
export const WORKSPACE_COLLECTION_KEYS: readonly string[] = [
  STORAGE_KEYS.notes,
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.snippets,
  STORAGE_KEYS.archive,
]

/**
 * Calls `listener` when another tab changes any of `keys` in this origin's
 * `localStorage`. Returns an unsubscribe that is safe to call more than once.
 *
 * A no-op when the browser has no `storage` event, so callers need no guard of
 * their own.
 */
export function subscribeToStorageKeys(
  keys: readonly string[],
  listener: () => void,
): () => void {
  const target = globalThis.window

  if (!target || typeof target.addEventListener !== 'function') {
    return () => {}
  }

  const watched = new Set(keys)

  const handler = (event: StorageEvent): void => {
    // `null` means the whole area was cleared, which can touch any watched key.
    if (event.key !== null && !watched.has(event.key)) {
      return
    }

    // Ignore `sessionStorage` (and any other area) sharing the event shape.
    if (event.storageArea && event.storageArea !== target.localStorage) {
      return
    }

    listener()
  }

  target.addEventListener('storage', handler)

  let subscribed = true

  return () => {
    if (!subscribed) {
      return
    }

    subscribed = false

    if (typeof target.removeEventListener === 'function') {
      target.removeEventListener('storage', handler)
    }
  }
}
