/**
 * x31Desk — the wording for a failed workspace startup.
 * ---------------------------------------------------------------------------
 * Kept apart from the screen so the copy is one testable function rather than
 * markup, and so every failure reason is guaranteed a message: an unhandled
 * reason would leave the user staring at an empty card. The screen imports only
 * {@link describeFailure}, which is also why this lives outside the component
 * file — a component module should export only its component.
 */

import type { WorkspaceStorageFailure } from '@/data/desktopStorage'

/** How many conflicting keys/sources to name before summarising the rest. */
const MAX_LISTED = 8

/** The heading, explanation and optional detail for a startup failure. */
export type FailureCopy = {
  readonly title: string
  readonly message: string
  /** Specific keys/collections involved, when the failure names any. */
  readonly detail: readonly string[]
}

/** The collection names as a reader would say them. */
const COLLECTION_LABELS: Record<string, string> = {
  notes: 'Notes',
  tasks: 'Tasks',
  snippets: 'Snippets',
  archive: 'Archive',
}

function labelFor(collection: string): string {
  return Object.hasOwn(COLLECTION_LABELS, collection)
    ? COLLECTION_LABELS[collection]
    : collection
}

/** Turns one conflicting key (`notes` + `n1`, or `archive` + `note:n1`) into a line. */
function describeConflict(collection: string, id: string): string {
  return `${labelFor(collection)} · ${id}`
}

/** Caps a list at {@link MAX_LISTED} entries, adding a "+N more" tail. */
function cap(items: readonly string[]): string[] {
  if (items.length <= MAX_LISTED) {
    return [...items]
  }

  return [...items.slice(0, MAX_LISTED), `+${items.length - MAX_LISTED} more`]
}

/**
 * The plain-language explanation of a startup failure.
 *
 * Every reason is covered, so the screen always has something specific to say
 * rather than a generic error.
 */
export function describeFailure(failure: WorkspaceStorageFailure): FailureCopy {
  switch (failure.reason) {
    case 'database-unavailable':
      return {
        title: 'x31Desk could not open your database',
        message:
          'The workspace database could not be opened, so x31Desk stopped before showing anything. Your existing data has not been changed or deleted.',
        detail: [],
      }
    case 'import-invalid':
      return {
        title: 'Some of your existing data could not be read',
        message:
          'Before moving to the database, x31Desk reads your saved workspace. One or more collections could not be read completely, so nothing was imported. The unreadable bytes were preserved, not deleted.',
        detail: cap(failure.collections.map(labelFor)),
      }
    case 'import-conflict':
      return {
        title: 'Your database and saved data disagree',
        message:
          'The database already holds records that differ from your saved workspace, so x31Desk stopped rather than overwrite either copy. Nothing was changed.',
        detail: cap(failure.conflicts.map((entry) => describeConflict(entry.collection, entry.id))),
      }
    case 'import-verification':
      return {
        title: 'Your data could not be verified',
        message:
          'x31Desk imported your workspace but could not confirm that everything arrived intact, so it undid the attempt. Nothing was changed.',
        detail: [],
      }
    case 'storage':
      return failure.kind === 'quota'
        ? {
            title: 'There is not enough space',
            message:
              'The workspace database could not be written because the disk is full. Free up some space and try again.',
            detail: [],
          }
        : {
            title: 'x31Desk could not open your workspace',
            message:
              'The workspace store could not be read, so x31Desk stopped before showing anything. Your existing data has not been changed or deleted.',
            detail: [],
          }
  }
}
