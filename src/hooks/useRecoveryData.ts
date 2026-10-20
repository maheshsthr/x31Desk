import { useCallback, useEffect, useState } from 'react'

import { readLocalRecovery, readRecovery, type RecoverySnapshot } from '@/data/recovery'

/**
 * The recovery data the Settings page reports on.
 *
 * The `localStorage` half is read synchronously for the first render, so the
 * notice can appear immediately when it exists. The SQLite archive vault is then
 * read asynchronously — it lives in the main process — and folded in when it
 * arrives. There is no subscription: recovery data changes only when the archive
 * is written or cleared, both of which the page already reloads after.
 *
 * `reload` both updates the page and resolves with the fresh snapshot, so the
 * export action can work from exactly what it just re-read rather than trusting
 * a possibly stale render.
 */
export function useRecoveryData(): {
  readonly snapshot: RecoverySnapshot
  readonly reload: () => Promise<RecoverySnapshot>
} {
  const [snapshot, setSnapshot] = useState<RecoverySnapshot>(readLocalRecovery)

  /**
   * Re-reads both sources, updates the page, and resolves with the fresh
   * snapshot. Called after a clear and before an export — both user actions, so
   * the state update is part of handling the event rather than a render loop.
   */
  const reload = useCallback(async () => {
    const next = await readRecovery()

    setSnapshot(next)

    return next
  }, [])

  // The first read on mount. The outcome lands in the callback, so nothing is
  // set synchronously here and the initial `localStorage` snapshot stands until
  // the vault read settles.
  useEffect(() => {
    let cancelled = false

    void readRecovery().then((next) => {
      if (!cancelled) {
        setSnapshot(next)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  return { snapshot, reload }
}
