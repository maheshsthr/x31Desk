import { useEffect, useRef } from 'react'

import { clearIntent, peekIntent, subscribeToIntents } from '@/navigation/intent'
import type { ViewIntent } from '@/types/navigation'

/**
 * Hands a page every view intent addressed to it.
 *
 * A page that is the destination of a cross-view navigation is reached by
 * reading the pending intent as it mounts. But the destination is often the view
 * the user is *already* in — picking a note from workspace search while on the
 * Notes page — and a mounted page never mounts again. Reading only on mount left
 * that request unclaimed: the item did not open, and worse, the stale intent
 * fired on the *next* visit. Subscribing as well as reading closes that gap
 * without remounting the page (which would drop its filters and re-read
 * storage).
 *
 * `handle` claims an intent by returning `true`; an intent it declines is left
 * pending for its real destination.
 */
export function useViewIntent(handle: (intent: ViewIntent) => boolean): void {
  // The handler closes over fresh page state each render, so it is read through
  // a ref: the subscription itself is registered exactly once.
  const handleRef = useRef(handle)

  useEffect(() => {
    handleRef.current = handle
  })

  useEffect(() => {
    const drain = () => {
      const intent = peekIntent()

      if (intent && handleRef.current(intent)) {
        clearIntent()
      }
    }

    // Claim anything that was already waiting when the page mounted, then keep
    // listening for requests that arrive while it stays on screen.
    drain()

    return subscribeToIntents(drain)
  }, [])
}
