/**
 * Workspace schema versioning.
 * ---------------------------------------------------------------------------
 * The workspace is stored as four JSON collections (notes, tasks, snippets and
 * the archive) plus two preferences. The shape of those records can change
 * between releases, so a version marker records which shape a workspace is in.
 * That lets a later release migrate an older workspace deliberately instead of
 * discarding every record that no longer passes its validator.
 *
 * Versioning is additive and non-destructive. A workspace written before
 * versioning existed simply has no marker: that is an unversioned workspace, not
 * corrupt data, and it is upgraded exactly like any older version. Record
 * payloads are only rewritten when a migration for that version actually
 * transforms them.
 */

import { STORAGE_KEYS } from '@/data/storageKeys'

/** The `localStorage` key holding the workspace schema version. */
export const SCHEMA_STORAGE_KEY = STORAGE_KEYS.schema

/** The schema version this build understands and writes. */
export const CURRENT_SCHEMA_VERSION = 1

/**
 * The version reported for a workspace with no marker — i.e. one written before
 * versioning existed. A legitimate older version, never treated as corruption.
 */
export const UNVERSIONED_SCHEMA = 0

/** One upgrade step, from the previous version to `to`. */
export type WorkspaceMigration = {
  /** The version this step produces. Steps run in ascending order. */
  readonly to: number
  /** A one-line summary of what the step changes. */
  readonly description: string
  /**
   * Applies the step. Must be safe to run once, must not delete user data, and
   * must leave the workspace in the shape of version `to` when it returns.
   */
  readonly run: () => void
}

/**
 * Every migration, oldest first.
 *
 * Only the current version exists. Version 0 (unversioned) and version 1 use the
 * same keys and record shapes — earlier builds already wrote exactly what this
 * build reads — so the 0 → 1 step records the version and rewrites nothing. A
 * step is only added here once the format change it describes has actually been
 * implemented; an entry is a promise that the data can be brought forward.
 */
const WORKSPACE_MIGRATIONS: readonly WorkspaceMigration[] = [
  {
    to: 1,
    description:
      'Adopt schema versioning. Unversioned workspaces already use the version 1 record shapes, so no records are rewritten.',
    run: () => {
      // Deliberately empty: version 0 and version 1 are byte-compatible, so
      // adopting versioning moves the marker and nothing else.
    },
  },
]

/** Reads the stored schema version, or 0 when the marker is absent or unusable. */
export function readSchemaVersion(): number {
  let raw: string | null

  try {
    raw = window.localStorage.getItem(SCHEMA_STORAGE_KEY)
  } catch {
    // Storage unavailable: report the workspace as unversioned.
    return UNVERSIONED_SCHEMA
  }

  if (raw === null || raw === '') {
    return UNVERSIONED_SCHEMA
  }

  const parsed = Number(raw)

  // A marker that cannot be read as a version is treated as unversioned rather
  // than as an error, so a damaged marker never blocks the workspace.
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : UNVERSIONED_SCHEMA
}

/** Writes the schema version. Best effort: versioning never blocks the app. */
function writeSchemaVersion(version: number): void {
  try {
    window.localStorage.setItem(SCHEMA_STORAGE_KEY, String(version))
  } catch {
    // Persistence is unavailable; the next start will try again.
  }
}

/**
 * Brings the workspace up to {@link CURRENT_SCHEMA_VERSION} and returns the
 * version it is left at.
 *
 * - A missing marker means an unversioned workspace, which is migrated normally.
 * - A marker at or above the current version is left untouched, so a workspace
 *   written by a newer build is never downgraded or migrated backwards.
 * - A migration that throws stops the run without advancing the marker, so it is
 *   retried on the next start rather than recorded as half-applied.
 */
export function ensureWorkspaceSchema(): number {
  const stored = readSchemaVersion()

  if (stored >= CURRENT_SCHEMA_VERSION) {
    return stored
  }

  let version = stored

  for (const migration of WORKSPACE_MIGRATIONS) {
    if (migration.to <= version || migration.to > CURRENT_SCHEMA_VERSION) {
      continue
    }

    try {
      migration.run()
    } catch {
      // Leave the marker where it is so the step can be retried, not skipped.
      return version
    }

    version = migration.to
    writeSchemaVersion(version)
  }

  return version
}
