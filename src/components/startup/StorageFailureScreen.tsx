import { HardDrive, RefreshCw, TriangleAlert } from 'lucide-react'

import { BrandMark } from '@/components/branding/BrandMark'
import { describeFailure } from '@/components/startup/failureCopy'
import { Button } from '@/components/ui/Button'
import type { WorkspaceStorageFailure } from '@/data/desktopStorage'

type StorageFailureScreenProps = {
  readonly failure: WorkspaceStorageFailure
  /** Re-runs startup; the database may open on a later attempt. */
  readonly onRetry: () => void
}

/**
 * The screen shown instead of the application when the desktop workspace cannot
 * be opened.
 *
 * It deliberately replaces the whole UI rather than showing an empty workspace:
 * once the import has completed, `localStorage` is no longer authoritative, so
 * mounting the shell would present stale records as the user's data. There is
 * one action — try again — because every failure here is either transient (a
 * locked or busy database) or requires the user to look at the file.
 */
export function StorageFailureScreen({ failure, onRetry }: StorageFailureScreenProps) {
  const copy = describeFailure(failure)

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-10">
      <div className="w-full max-w-lg rounded-lg border border-line bg-surface p-6 shadow-sm">
        <BrandMark variant="full" size={56} />

        <div className="mt-5 flex items-start gap-3">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-sm bg-warning-soft text-warning">
            <TriangleAlert aria-hidden className="size-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight text-ink">{copy.title}</h1>
            <p className="mt-1.5 text-sm text-ink-muted">{copy.message}</p>
          </div>
        </div>

        {copy.detail.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-1 rounded-sm border border-line bg-canvas px-3 py-2.5 font-mono text-xs text-ink-muted">
            {copy.detail.map((line) => (
              <li key={line} className="truncate">
                {line}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <HardDrive aria-hidden className="size-3.5" strokeWidth={1.9} />
            Your data was left untouched.
          </span>
          <Button variant="primary" icon={RefreshCw} onClick={onRetry}>
            Try again
          </Button>
        </div>
      </div>
    </div>
  )
}
