import { BrandMark } from '@/components/branding/BrandMark'

/**
 * Shown for the moment between the first paint and the workspace being ready.
 *
 * Startup now does real work before the shell can be mounted — the desktop shell
 * opens the database and runs the one-time import — so there is a genuine gap
 * where the window is up but has nothing to show. Rendering the brand and a
 * quiet "Loading" rather than a blank canvas keeps that gap intentional instead
 * of looking like a failed load.
 */
export function StartupSplash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
        <BrandMark variant="full" size={120} />
        <span className="text-xs text-ink-muted">Loading your workspace…</span>
      </div>
    </div>
  )
}
