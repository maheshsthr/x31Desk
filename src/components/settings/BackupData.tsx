import { Download, TriangleAlert, Upload } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { FieldRow } from '@/components/settings/FieldRow'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import {
  describeCounts,
  runBackupExport,
  runBackupImport,
  runBackupInspect,
  totalRecords,
} from '@/data/backup'
import type { BackupImportMode, BackupPreview } from '@/data/ipc/contract'
import type { BackupDocument } from '@/data/ipc/contract'
import { useToast } from '@/hooks/useToast'

/** How the preview dialog presents the two ways a backup can be applied. */
const MODE_OPTIONS: readonly { value: BackupImportMode; label: string }[] = [
  { value: 'merge', label: 'Add to this workspace' },
  { value: 'replace', label: 'Replace this workspace' },
]

/** The file the user picked, plus what the main process found in it. */
type PickedBackup = {
  readonly fileName: string
  readonly preview: BackupPreview
  /** Passed back unchanged; the renderer never edits a document. */
  readonly document: BackupDocument
}

/** How long the success toast is given before the window reloads. */
const RELOAD_DELAY_MS = 1400

/** The export timestamp, or the raw text when it is not a parseable date. */
function describeExportedAt(iso: string): string {
  const timestamp = Date.parse(iso)

  if (Number.isNaN(timestamp)) {
    return iso
  }

  return new Date(timestamp).toLocaleString()
}

/**
 * The two backup rows in the Settings Workspace section, and the import preview.
 *
 * The rows mirror each other: one writes a `.x31backup` file through a native
 * save dialog, the other reads one back through a native open dialog. Neither
 * shows a filesystem path — the dialogs are native and the file is the user's
 * to place; the app only ever reports the name it chose.
 *
 * The import is deliberately two steps. Reading a file stops at a preview that
 * says what the backup holds and how it can be applied; the write happens only
 * after the user has chosen a mode, and "replace" passes through a destructive
 * confirmation of its own. Nothing is written between the picker opening and
 * that confirmation, so cancelling at any point leaves the workspace exactly as
 * it was.
 *
 * In a browser the rows are rendered disabled with the reason spelled out, since
 * the workspace there is not in a database this feature can read or write.
 */
export function BackupData({ isDesktop }: { readonly isDesktop: boolean }) {
  const { notify } = useToast()
  const previewDialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  const [busy, setBusy] = useState<'export' | 'inspect' | 'import' | null>(null)
  const [picked, setPicked] = useState<PickedBackup | null>(null)
  const [mode, setMode] = useState<BackupImportMode>('merge')
  const [isConfirmingReplace, setIsConfirmingReplace] = useState(false)

  // The dialog follows `picked` exactly as `ConfirmDialog` follows its `open`
  // prop, so one piece of state is the truth and the element cannot drift.
  useEffect(() => {
    const dialog = previewDialogRef.current

    if (!dialog) {
      return
    }

    if (picked !== null && !dialog.open) {
      dialog.showModal()
    } else if (picked === null && dialog.open) {
      dialog.close()
    }
  }, [picked])

  const createBackup = async () => {
    setBusy('export')

    try {
      const report = await runBackupExport()

      switch (report.kind) {
        case 'unsupported':
          notify('Backups are only available in the desktop app.')
          return

        case 'cancelled':
          return

        case 'failed':
          notify(report.message)
          return

        case 'written': {
          const contents =
            totalRecords(report.counts) === 0
              ? 'Backed up an empty workspace'
              : `Backed up ${describeCounts(report.counts)}`

          const note =
            report.unreadableArchiveRows > 0
              ? ` ${report.unreadableArchiveRows} unreadable archive ${report.unreadableArchiveRows === 1 ? 'record was' : 'records were'} left out; use “Export unreadable data” to save them separately.`
              : ''

          notify(`${contents} to ${report.fileName}.${note}`)
          return
        }
      }
    } finally {
      setBusy(null)
    }
  }

  const chooseBackup = async () => {
    setBusy('inspect')

    try {
      const report = await runBackupInspect()

      switch (report.kind) {
        case 'unsupported':
          notify('Importing a backup is only available in the desktop app.')
          return

        case 'cancelled':
          return

        case 'rejected':
        case 'failed':
          notify(report.message)
          return

        case 'ready':
          // Start on the safe mode every time; replacing is a deliberate second
          // choice, never the default a confirmation dialog inherits.
          setMode('merge')
          setPicked({
            fileName: report.fileName,
            preview: report.preview,
            document: report.document,
          })
          return
      }
    } finally {
      setBusy(null)
    }
  }

  const confirmImport = async (chosen: BackupImportMode) => {
    const selection = picked

    if (selection === null) {
      return
    }

    setBusy('import')
    setIsConfirmingReplace(false)

    try {
      const report = await runBackupImport({ document: selection.document, mode: chosen })

      switch (report.kind) {
        case 'unsupported':
          notify('Importing a backup is only available in the desktop app.')
          return

        case 'rejected':
        case 'failed':
          notify(report.message)
          return

        case 'applied':
          // Closed before the toast so the dialog is gone by the time the user
          // looks back at the page.
          setPicked(null)
          notify(report.message)

          if (report.needsReload) {
            // The task and archive stores load once per session and offer no
            // refresh, so the workspace is re-read from the database by loading
            // the page again. The delay lets the message be read first.
            window.setTimeout(() => {
              window.location.reload()
            }, RELOAD_DELAY_MS)
          }

          return
      }
    } finally {
      setBusy(null)
    }
  }

  const recordCount = picked === null ? 0 : totalRecords(picked.preview.counts)
  const restorePreferences = picked?.preview.hasPreferences ?? false

  // Written as complete sentences rather than two conditional fragments, so an
  // empty backup cannot claim to restore preferences while the sentence beside it
  // says the file carries none.
  const previewNotes: string[] = []

  if (recordCount === 0 && !restorePreferences) {
    previewNotes.push('This backup holds no records and no preferences, so importing it would change nothing.')
  } else if (recordCount === 0) {
    previewNotes.push('This backup holds no records; importing it restores your preferences only.')
  } else {
    previewNotes.push('The file is read and checked before anything is written.')

    if (restorePreferences) {
      previewNotes.push('It also carries your theme, editor and UI scale preferences.')
    } else {
      previewNotes.push('It carries no preferences, so yours are left as they are.')
    }
  }

  // The confirmation must not read "restores nothing from the backup" as though it
  // were describing a real restore.
  const confirmDescription =
    picked === null
      ? ''
      : recordCount === 0
        ? `This permanently deletes every note, task, snippet and archived item on this device and restores nothing, because that backup is empty. It cannot be undone. Your preferences are ${restorePreferences ? 'restored from the backup' : 'left as they are'}.`
        : `This permanently deletes every note, task, snippet and archived item on this device, then restores ${describeCounts(picked.preview.counts)} from the backup. It cannot be undone. Your preferences are ${restorePreferences ? 'restored from the backup' : 'left as they are'}.`

  return (
    <>
      <FieldRow
        title="Back up data"
        description={
          isDesktop
            ? 'Save every note, task, snippet and archived item — with your preferences — to a single .x31backup file you choose.'
            : 'Backups are only available in the desktop app, where the workspace is kept in a database this feature can read.'
        }
      >
        <Button
          variant="secondary"
          icon={busy === 'export' ? undefined : Download}
          disabled={!isDesktop || busy !== null}
          onClick={() => {
            void createBackup()
          }}
        >
          {busy === 'export' ? 'Backing up…' : 'Back up…'}
        </Button>
      </FieldRow>

      <FieldRow
        title="Import from backup"
        description={
          isDesktop
            ? 'Read a .x31backup file. You will see what it holds before anything changes; adding it never overwrites what you already have.'
            : 'Restoring a backup is only available in the desktop app.'
        }
      >
        <Button
          variant="secondary"
          icon={busy === 'inspect' ? undefined : Upload}
          disabled={!isDesktop || busy !== null}
          onClick={() => {
            void chooseBackup()
          }}
        >
          {busy === 'inspect' ? 'Choosing…' : 'Import…'}
        </Button>
      </FieldRow>

      {/*
        Built on the native `<dialog>` for the same reason `ConfirmDialog` is:
        `showModal()` supplies the focus trap, page inertness and `Esc` handling
        that a hand-rolled overlay would have to re-earn.
      */}
      <dialog
        ref={previewDialogRef}
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault()
          setPicked(null)
        }}
        // A click lands on the dialog itself only when it hits the backdrop.
        onClick={(event) => {
          if (event.target === previewDialogRef.current) {
            setPicked(null)
          }
        }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[28rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-line bg-surface p-0 text-ink shadow-floating backdrop:bg-scrim"
      >
        {picked === null ? null : (
          <div className="p-5">
            <h2 id={titleId} className="text-sm font-semibold text-ink">
              Import from backup
            </h2>

            <p className="mt-1.5 text-xs text-ink-muted">
              {picked.fileName} — written by x31Desk {picked.preview.appVersion} on{' '}
              {describeExportedAt(picked.preview.exportedAt)}.
            </p>

            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-sm border border-line bg-canvas px-3 py-2.5 text-xs">
              <BackupCount label="Notes" value={picked.preview.counts.notes} />
              <BackupCount label="Tasks" value={picked.preview.counts.tasks} />
              <BackupCount label="Snippets" value={picked.preview.counts.snippets} />
              <BackupCount label="Archived items" value={picked.preview.counts.archive} />
            </dl>

            <p className="mt-3 flex items-start gap-2 text-xs text-ink-muted">
              <TriangleAlert
                aria-hidden
                className="mt-0.5 size-3.5 shrink-0 text-warning"
                strokeWidth={1.9}
              />
              <span>{previewNotes.join(' ')}</span>
            </p>

            <fieldset className="mt-4" disabled={busy !== null}>
              <legend className="text-xs font-medium text-ink">How to apply it</legend>

              <SegmentedControl
                className="mt-2"
                label="Import mode"
                options={MODE_OPTIONS}
                value={mode}
                onChange={setMode}
              />

              <p className="mt-2 text-xs text-ink-muted">
                {mode === 'merge'
                  ? 'Adds the records this workspace does not already have. Anything you already hold keeps its current content, and a same-id difference is reported rather than overwritten.'
                  : 'Clears this workspace first, then restores the backup exactly. Everything not in the backup is lost.'}
              </p>
            </fieldset>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                disabled={busy !== null}
                onClick={() => {
                  setPicked(null)
                }}
              >
                Cancel
              </Button>

              <Button
                variant={mode === 'replace' ? 'danger' : 'primary'}
                disabled={busy !== null}
                onClick={() => {
                  if (mode === 'replace') {
                    setIsConfirmingReplace(true)
                    return
                  }

                  void confirmImport('merge')
                }}
              >
                {busy === 'import'
                  ? 'Importing…'
                  : mode === 'replace'
                    ? 'Replace workspace…'
                    : 'Add to this workspace'}
              </Button>
            </div>
          </div>
        )}
      </dialog>

      <ConfirmDialog
        open={isConfirmingReplace}
        title="Replace this workspace?"
        description={confirmDescription}
        confirmLabel="Replace workspace"
        destructive
        onConfirm={() => {
          void confirmImport('replace')
        }}
        onCancel={() => setIsConfirmingReplace(false)}
      />
    </>
  )
}

/** One line of the preview's counts table. */
function BackupCount({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-ink">
        {value.toLocaleString()}
      </dd>
    </>
  )
}
