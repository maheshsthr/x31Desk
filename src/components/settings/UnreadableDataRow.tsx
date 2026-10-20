import { Download, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { buildRecoveryExport, recoveryExportFilename } from '@/data/quarantine'
import type { RecoverySnapshot } from '@/data/recovery'
import { useToast } from '@/hooks/useToast'
import { downloadTextFile } from '@/utils/download'

type UnreadableDataRowProps = {
  /** Everything recoverable, across both stores. */
  readonly snapshot: RecoverySnapshot
  /**
   * Re-reads both sources, updates the page, and resolves with the fresh
   * snapshot, so an export is always built from what exists right now.
   */
  readonly onReload: () => Promise<RecoverySnapshot>
}

/** "Notes", "Notes and Tasks", "Notes, Tasks and Archive". */
function joinLabels(labels: readonly string[]): string {
  if (labels.length === 1) {
    return labels[0]
  }

  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/**
 * The collections the notice should name.
 *
 * The `localStorage` payloads carry their own label; the SQLite vault is always
 * the archive, so it contributes "Archive" once however many rows it holds. The
 * result is de-duplicated and kept in first-seen order.
 */
function describeScope(snapshot: RecoverySnapshot): string {
  const labels: string[] = []

  for (const payload of snapshot.payloads) {
    if (!labels.includes(payload.label)) {
      labels.push(payload.label)
    }
  }

  if (snapshot.archiveCorruption.length > 0 && !labels.includes('Archive')) {
    labels.push('Archive')
  }

  return joinLabels(labels)
}

/**
 * The Settings notice and export action for unreadable workspace data.
 *
 * Shown while anything recoverable — or unreadable — exists. It explains, in
 * plain language, that data could not be read and was kept instead of deleted,
 * and offers a download of the exact preserved bytes. The payloads themselves
 * are never rendered here — recovery is a file the user takes elsewhere, not
 * something the app displays.
 *
 * The export is one document covering both stores: the `localStorage` quarantine
 * and the SQLite archive vault. Exporting reads only, so it can never disturb
 * the data it reports.
 */
export function UnreadableDataRow({ snapshot, onReload }: UnreadableDataRowProps) {
  const { notify } = useToast()

  const exportRecoveryData = async () => {
    // Re-read at click time: an archive write, another tab or a clear may have
    // changed what exists since this row rendered.
    const current = await onReload()
    const total = current.payloads.length + current.archiveCorruption.length

    if (total === 0) {
      notify(
        current.archiveUnavailable
          ? 'The archive data could not be read, so nothing was exported.'
          : 'There is no unreadable data to export.',
      )

      return
    }

    const exportedAt = new Date().toISOString()
    const contents = buildRecoveryExport(
      current.payloads,
      { exportedAt, appVersion: __APP_VERSION__ },
      current.archiveCorruption,
    )
    const downloaded = downloadTextFile(recoveryExportFilename(exportedAt), contents)

    notify(
      downloaded
        ? `Exported ${total} unreadable ${total === 1 ? 'record' : 'records'}.`
        : 'The unreadable data could not be exported.',
    )
  }

  const scope = describeScope(snapshot)

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 basis-56 items-start gap-2.5">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-sm bg-warning-soft text-warning">
          <TriangleAlert aria-hidden className="size-3.5" strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Some workspace data couldn't be read</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {scope.length > 0
              ? `Data from ${scope} could not be understood and was kept for recovery instead of deleted. It is not shown in the app; export it to save a copy.`
              : 'Some data could not be understood and was kept for recovery instead of deleted. It is not shown in the app; export it to save a copy.'}
            {snapshot.archiveUnavailable
              ? ' The archive could not be checked for unreadable records.'
              : ''}
          </p>
        </div>
      </div>

      <div className="shrink-0">
        <Button
          variant="secondary"
          icon={Download}
          onClick={() => {
            void exportRecoveryData()
          }}
        >
          Export unreadable data
        </Button>
      </div>
    </div>
  )
}
