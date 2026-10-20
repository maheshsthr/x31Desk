/**
 * x31Desk — reading everything the recovery export can contain.
 * ---------------------------------------------------------------------------
 * Recovery data lives in two places, depending on which store is authoritative:
 *
 *   * **`localStorage` quarantine** — a collection reader copies bytes it could
 *     not parse to a sibling `:unreadable` key before discarding them. This is
 *     the only record of pre-switchover corruption, and it is still read here on
 *     every platform.
 *   * **The SQLite archive vault** — the desktop archive adapter copies a row
 *     whose `data` column will not read back into `archive_corruption`, beside
 *     the identity columns. The renderer reaches it only through the read-only
 *     `archiveCorruption` channel.
 *
 * This module is the one place the two are combined for the Settings page. It
 * never writes or deletes anything: it reads, and reports whether the vault
 * could not be read so the page can say so rather than imply the archive is
 * clean.
 */

import { unwrapIpcResult } from '@/data/ipc/unwrap'
import { readQuarantinedPayloads, type QuarantinedPayload } from '@/data/quarantine'
import type { ArchiveCorruptionEntry } from '@/data/ipc/contract'
import type { DesktopRecoveryBridge } from '@/types/desktop'

/** Everything a recovery export can contain, read in one pass. */
export type RecoverySnapshot = {
  /** Unreadable `localStorage` payloads, exactly as preserved. */
  readonly payloads: readonly QuarantinedPayload[]
  /** Archive rows the SQLite adapter could not read back, verbatim. */
  readonly archiveCorruption: readonly ArchiveCorruptionEntry[]
  /**
   * True when the shell is present but the vault could not be read, so the
   * archive's state is unknown rather than known-empty.
   */
  readonly archiveUnavailable: boolean
}

/** The `localStorage` half, read synchronously. Used for the first render. */
export function readLocalRecovery(): RecoverySnapshot {
  return { payloads: readQuarantinedPayloads(), archiveCorruption: [], archiveUnavailable: false }
}

/** The recovery bridge, when the renderer is running inside Electron. */
function recoveryBridge(): DesktopRecoveryBridge | undefined {
  return window.x31deskDesktop?.recovery
}

/**
 * Reads both recovery sources.
 *
 * A missing bridge is not a failure: the web build simply has no vault, so the
 * archive list is empty and `archiveUnavailable` stays false. A read that fails
 * *behind* a present bridge is reported as `archiveUnavailable`, because the
 * vault may hold entries the page cannot see.
 */
export async function readRecovery(
  bridge: DesktopRecoveryBridge | undefined = recoveryBridge(),
): Promise<RecoverySnapshot> {
  const payloads = readQuarantinedPayloads()

  if (bridge === undefined) {
    return { payloads, archiveCorruption: [], archiveUnavailable: false }
  }

  try {
    const archiveCorruption = unwrapIpcResult(await bridge.archiveCorruption())

    return { payloads, archiveCorruption, archiveUnavailable: false }
  } catch {
    return { payloads, archiveCorruption: [], archiveUnavailable: true }
  }
}

/** Whether anything recoverable — or unreadable — was found. */
export function hasRecovery(snapshot: RecoverySnapshot): boolean {
  return (
    snapshot.payloads.length > 0 ||
    snapshot.archiveCorruption.length > 0 ||
    snapshot.archiveUnavailable
  )
}
