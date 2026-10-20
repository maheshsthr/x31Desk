import { useCallback, useEffect, useState } from 'react'

import App from '@/App'
import { StartupSplash } from '@/components/startup/StartupSplash'
import { StorageFailureScreen } from '@/components/startup/StorageFailureScreen'
import {
  initializeWorkspaceStorage,
  type WorkspaceStorageReport,
} from '@/data/desktopStorage'

/** The failure half of a storage report, as handed to the error screen. */
type WorkspaceStorageFailureReport = Extract<WorkspaceStorageReport, { ok: false }>

type StartupState =
  | { readonly status: 'starting' }
  | { readonly status: 'ready' }
  | { readonly status: 'failed'; readonly report: WorkspaceStorageFailureReport }

/**
 * The application's entry point.
 *
 * It owns the one decision that must happen before any collection is read —
 * which store is authoritative — and mounts the shell only when that decision is
 * a success. On a failure it shows the reason instead of the workspace, so a
 * database that could not be opened, or an import that could not complete, is
 * never mistaken for an empty workspace. `initializeWorkspaceStorage` binds the
 * stores as a side effect of succeeding, so by the time `<App/>` mounts every
 * repository call already reaches the right backend.
 *
 * `App` is imported eagerly rather than lazily: the graph is needed for either
 * outcome, and the app is a single local document with no network to save.
 */
export function Startup() {
  const [state, setState] = useState<StartupState>({ status: 'starting' })

  /** Runs startup once and records the outcome. */
  const begin = useCallback(() => {
    void initializeWorkspaceStorage().then((report) => {
      setState(report.ok ? { status: 'ready' } : { status: 'failed', report })
    })
  }, [])

  // The initial attempt. No `setState` runs synchronously here: the outcome
  // lands in the callback, and the first render is already the splash.
  useEffect(() => {
    begin()
  }, [begin])

  /** Retry from the error screen: go back to the splash, then attempt again. */
  const retry = useCallback(() => {
    setState({ status: 'starting' })
    begin()
  }, [begin])

  switch (state.status) {
    case 'ready':
      return <App />
    case 'failed':
      return <StorageFailureScreen failure={state.report.failure} onRetry={retry} />
    case 'starting':
      return <StartupSplash />
  }
}
