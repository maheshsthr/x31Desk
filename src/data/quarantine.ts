/**
 * Recovery for unreadable workspace payloads.
 * ---------------------------------------------------------------------------
 * Each collection reader copies bytes it cannot fully understand to a sibling
 * `:unreadable` key before discarding them, so a bad payload is preserved rather
 * than silently destroyed. That copy is the *only* record of what could not be
 * read, which makes it the one thing a recovery feature can act on.
 *
 * This module is the single source of truth for those keys, plus the detection
 * and export the Settings page uses. It deliberately never parses a quarantined
 * payload: the bytes are handed back exactly as they were stored, because a
 * payload that could not be understood is precisely the wrong thing to run
 * through a normaliser.
 *
 * Nothing here removes a payload. Recovery is read-only: it detects what exists
 * and packages a copy, and the existing "clear workspace data" flow stays the
 * only thing that deletes quarantined bytes.
 */

import type { ArchiveCorruptionEntry } from '@/data/ipc/contract'

/** The collections whose readers quarantine unreadable data. */
export type CollectionName = 'notes' | 'tasks' | 'snippets' | 'archive'

/**
 * The quarantine key each collection's reader copies unreadable bytes to.
 *
 * The readers import this record, so a recovery lookup can never address a key
 * the readers do not actually write.
 */
export const QUARANTINE_KEYS: Record<CollectionName, string> = {
  notes: 'x31desk:notes:unreadable',
  tasks: 'x31desk:tasks:unreadable',
  snippets: 'x31desk:snippets:unreadable',
  archive: 'x31desk:archive:unreadable',
}

/** The shared shape of a quarantine key: `x31desk:<collection>:unreadable`. */
const QUARANTINE_KEY_PATTERN = /^x31desk:(.+):unreadable$/

/** Plain-language names, so a notice can name the affected data without exposing it. */
const COLLECTION_LABELS: Record<CollectionName, string> = {
  notes: 'Notes',
  tasks: 'Tasks',
  snippets: 'Snippets',
  archive: 'Archive',
}

/** Every quarantinable collection, in the order a recovery notice lists them. */
export const QUARANTINE_COLLECTIONS: readonly CollectionName[] = [
  'notes',
  'tasks',
  'snippets',
  'archive',
]

/** One preserved payload: its collection, the key holding it, and the raw bytes. */
export type QuarantinedPayload = {
  readonly collection: string
  readonly label: string
  /** The `:unreadable` key the payload is stored under. */
  readonly storageKey: string
  /** The original bytes, exactly as written. Never parsed or normalised. */
  readonly payload: string
}

/**
 * Preserves a payload we could not fully understand instead of destroying it.
 *
 * Write-once: the first unreadable value is kept for post-mortem recovery while
 * later writes are allowed to move on, so a second corruption can never replace
 * the original. Storage failures are swallowed — preserving data is best effort
 * and must never stop a reader from returning a usable collection.
 */
export function preserveUnreadable(quarantineKey: string, raw: string): void {
  try {
    if (window.localStorage.getItem(quarantineKey) === null) {
      window.localStorage.setItem(quarantineKey, raw)
    }
  } catch {
    // Storage is unavailable, so there is nothing to preserve.
  }
}

/**
 * Every quarantined payload currently held in storage.
 *
 * A key only counts as recoverable data when it holds something: the readers
 * never write an empty payload, and an absent or blank value is not recoverable.
 * Storage being unavailable reports nothing rather than throwing, so the
 * Settings page can always render.
 *
 * The known collections are listed first and in a fixed order. Any other
 * `x31desk:*:unreadable` key is then picked up too — it is preserved data all
 * the same, and a collection added in a later build should not fall through the
 * recovery net just because this module predates it.
 */
export function readQuarantinedPayloads(): QuarantinedPayload[] {
  const found: QuarantinedPayload[] = []
  const seen = new Set<string>()

  for (const collection of QUARANTINE_COLLECTIONS) {
    const storageKey = QUARANTINE_KEYS[collection]
    seen.add(storageKey)

    const payload = readQuarantineValue(storageKey)

    if (payload !== null) {
      found.push({ collection, label: COLLECTION_LABELS[collection], storageKey, payload })
    }
  }

  for (const storageKey of listQuarantineKeys()) {
    if (seen.has(storageKey)) {
      continue
    }

    const payload = readQuarantineValue(storageKey)

    if (payload !== null) {
      const collection = collectionFromKey(storageKey)
      found.push({ collection, label: labelFor(collection), storageKey, payload })
    }
  }

  return found
}

/** Whether any preserved, recoverable payload exists. */
export function hasQuarantinedData(): boolean {
  return readQuarantinedPayloads().length > 0
}

/** A payload's bytes, or `null` when the key is absent, blank or unreachable. */
function readQuarantineValue(storageKey: string): string | null {
  let payload: string | null

  try {
    payload = window.localStorage.getItem(storageKey)
  } catch {
    return null
  }

  return payload === null || payload === '' ? null : payload
}

/** Every `x31desk:*:unreadable` key present in storage, sorted for stable output. */
function listQuarantineKeys(): string[] {
  const keys: string[] = []

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)

      if (key !== null && QUARANTINE_KEY_PATTERN.test(key)) {
        keys.push(key)
      }
    }
  } catch {
    // Storage unavailable: there is nothing to enumerate.
  }

  return keys.sort()
}

/** The collection segment of a quarantine key, e.g. `notes`. */
function collectionFromKey(storageKey: string): string {
  return QUARANTINE_KEY_PATTERN.exec(storageKey)?.[1] ?? storageKey
}

/** A readable label for a collection discovered by key, e.g. `notes` → `Notes`. */
function labelFor(collection: string): string {
  // `hasOwn` keeps a crafted key such as `x31desk:constructor:unreadable` from
  // resolving to an inherited object property instead of a real label.
  if (Object.hasOwn(COLLECTION_LABELS, collection)) {
    return COLLECTION_LABELS[collection as CollectionName]
  }

  return collection.charAt(0).toUpperCase() + collection.slice(1)
}

/** Identifies the recovery file format, so an importer can recognise it. */
export const RECOVERY_EXPORT_FORMAT = 'x31desk.recovery'

/**
 * The version of {@link RECOVERY_EXPORT_FORMAT} this build writes.
 *
 * Version 2 adds the `archiveCorruption` section, which carries the SQLite
 * archive rows that could not be read back. Version 1 exports (the four
 * `localStorage` quarantine keys only) remain valid to import; a reader selects
 * the fields it knows and ignores the rest.
 */
export const RECOVERY_EXPORT_FORMAT_VERSION = 2

export type RecoveryExportMetadata = {
  /** When the export was produced, as an ISO 8601 timestamp. */
  readonly exportedAt: string
  /** The application version that produced it. */
  readonly appVersion: string
}

/**
 * Builds the downloadable recovery document.
 *
 * The payloads are embedded verbatim — as JSON string values — so the export is
 * an exact copy of what was quarantined, with no parsing, repair or pretty
 * printing of the payload itself. JSON escaping is the container's encoding, not
 * a change to the recovered value.
 *
 * `archiveCorruption` is the SQLite archive vault: rows the desktop adapter
 * copied aside because their `data` column would not read back as an
 * {@link ArchivedItem}. They are embedded verbatim for the same reason, and
 * omitted entirely when there is no vault (the web build). Exporting never
 * writes, moves or deletes an entry, so it is safe to run repeatedly.
 */
export function buildRecoveryExport(
  payloads: readonly QuarantinedPayload[],
  metadata: RecoveryExportMetadata,
  archiveCorruption: readonly ArchiveCorruptionEntry[] = [],
): string {
  return JSON.stringify(
    {
      format: RECOVERY_EXPORT_FORMAT,
      formatVersion: RECOVERY_EXPORT_FORMAT_VERSION,
      exportedAt: metadata.exportedAt,
      appVersion: metadata.appVersion,
      payloadCount: payloads.length,
      archiveCorruptionCount: archiveCorruption.length,
      payloads: payloads.map((entry) => ({
        collection: entry.collection,
        label: entry.label,
        storageKey: entry.storageKey,
        payload: entry.payload,
      })),
      archiveCorruption: archiveCorruption.map((entry) => ({
        type: entry.type,
        recordId: entry.recordId,
        archivedAt: entry.archivedAt,
        detectedAt: entry.detectedAt,
        data: entry.data,
      })),
    },
    null,
    2,
  )
}

/**
 * A filesystem-safe download name derived from the export timestamp, e.g.
 * `x31desk-recovery-2026-10-15T09-30-00-000Z.json`. Colons and dots would be
 * rejected by some filesystems, so they are replaced with dashes.
 */
export function recoveryExportFilename(exportedAt: string): string {
  return `x31desk-recovery-${exportedAt.replace(/[:.]/g, '-')}.json`
}
