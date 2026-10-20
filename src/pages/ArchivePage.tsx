import { Archive, SearchX } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { ArchiveFilters } from '@/components/archive/ArchiveFilters'
import { ArchiveList } from '@/components/archive/ArchiveList'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { getLastStorageErrorKind, storageErrorMessage } from '@/data/storageError'
import { useArchive } from '@/hooks/useArchive'
import { useToast } from '@/hooks/useToast'
import { useViewIntent } from '@/hooks/useViewIntent'
import { peekIntent } from '@/navigation/intent'
import type { ArchivedItem, ArchiveFilter } from '@/types/archive'
import {
  ARCHIVE_TYPE_LABELS,
  archiveCounts,
  archivedTitle,
  selectArchivedItems,
} from '@/utils/archive'
import { truncate } from '@/utils/text'

/**
 * The archive workspace: everything set aside from the notes, tasks and
 * snippets workspaces, in one searchable, filterable list.
 *
 * The page only reads and mutates the shared archive store; restoring and
 * deleting go through it so a record always lands back in exactly the module it
 * came from. Only permanent deletion is gated behind a confirmation — restoring
 * and archiving are both reversible, so they are not.
 */
export function ArchivePage() {
  const { notify } = useToast()
  const { items, isLoading, restore, deleteForever } = useArchive()

  const [filter, setFilter] = useState<ArchiveFilter>('all')
  // A workspace-search result for an archived item has no detail pane to open,
  // so it arrives as the text to reveal the item in this list. Read during the
  // first render — a read, not a claim — so the list is already filtered on its
  // first paint, then released below.
  const [query, setQuery] = useState(() => {
    const intent = peekIntent()

    return intent?.type === 'search-archive' ? intent.query : ''
  })
  const [pendingDelete, setPendingDelete] = useState<ArchivedItem | null>(null)

  // Releases the request read during the first render — and, because workspace
  // search can pick an archived item while this page is already open, also
  // applies a request that arrives later instead of leaving it stranded.
  useViewIntent((intent) => {
    if (intent.type !== 'search-archive') {
      return false
    }

    setQuery(intent.query)
    return true
  })

  const counts = useMemo(() => archiveCounts(items), [items])
  const visibleItems = useMemo(
    () => selectArchivedItems(items, filter, query),
    [filter, items, query],
  )

  const handleRestore = useCallback(
    (item: ArchivedItem) => {
      void restore(item).then((restored) => {
        notify(
          restored
            ? `${ARCHIVE_TYPE_LABELS[item.type]} restored.`
            : storageErrorMessage(
                getLastStorageErrorKind(),
                `That ${item.type} could not be restored.`,
              ),
        )
      })
    },
    [notify, restore],
  )

  const handleDelete = useCallback(() => {
    const item = pendingDelete
    setPendingDelete(null)

    if (!item) {
      return
    }

    void deleteForever(item).then((deleted) => {
      notify(
        deleted
          ? `${ARCHIVE_TYPE_LABELS[item.type]} deleted permanently.`
          : storageErrorMessage(
              getLastStorageErrorKind(),
              `That ${item.type} could not be deleted.`,
            ),
      )
    })
  }, [deleteForever, notify, pendingDelete])

  const quotedTitle = pendingDelete ? truncate(archivedTitle(pendingDelete)) : ''
  const isFiltering = query.trim() !== ''

  return (
    <>
      <PageHeader
        title="Archive"
        description="Everything you set aside, kept out of the way but ready to bring back."
      />

      {isLoading ? (
        <p className="mt-5 text-sm text-ink-muted">Loading archive…</p>
      ) : items.length === 0 ? (
        <EmptyState
          className="mt-5 flex-1 justify-center"
          icon={Archive}
          title="Nothing archived yet"
          description="Archive a note, task or snippet and it will appear here — out of its workspace, but never deleted."
        />
      ) : (
        <div className="mt-5 flex min-h-[24rem] flex-1 flex-col gap-4">
          <ArchiveFilters
            filter={filter}
            onFilterChange={setFilter}
            query={query}
            onQueryChange={setQuery}
            counts={counts}
          />

          <ArchiveList
            items={visibleItems}
            empty={
              isFiltering ? (
                <EmptyState
                  variant="inline"
                  icon={SearchX}
                  title="No matching items"
                  description="Try a different word or filter."
                />
              ) : (
                <EmptyState
                  variant="inline"
                  icon={Archive}
                  title="Nothing in this filter"
                  description="Items you archive will appear here."
                />
              )
            }
            onRestore={handleRestore}
            onDelete={setPendingDelete}
          />
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete permanently?"
        description={
          quotedTitle
            ? `“${quotedTitle}” will be deleted from this device for good. This cannot be undone.`
            : 'This item will be deleted from this device for good. This cannot be undone.'
        }
        confirmLabel="Delete permanently"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />
    </>
  )
}
