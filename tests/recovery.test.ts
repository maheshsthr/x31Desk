// Reading recovery data across both stores, and the export document.
// ---------------------------------------------------------------------------
// Recovery data comes from two places: the `localStorage` `:unreadable` keys and
// the SQLite archive vault (read over IPC). These tests pin:
//
//   * the web build reading only `localStorage`, with no vault and no error;
//   * the desktop reading folding the vault in, verbatim;
//   * a vault that cannot be read being reported as *unknown*, never as empty;
//   * the export document carrying both sources, each byte-for-byte, with the
//     format version that says so.
//
// Dependency-free: Node's built-in test runner and type stripping.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ArchiveCorruptionEntry } from '@/data/ipc/contract'
import { QUARANTINE_KEYS, buildRecoveryExport, RECOVERY_EXPORT_FORMAT_VERSION } from '@/data/quarantine'
import { hasRecovery, readLocalRecovery, readRecovery } from '@/data/recovery'
import type { DesktopRecoveryBridge } from '@/types/desktop'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function createFakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))

  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value))
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
    dump: () => Object.fromEntries(map),
  }
}

function installWindow(storage: ReturnType<typeof createFakeStorage>, bridge?: unknown): void {
  globalThis.window = {
    localStorage: storage,
    x31deskDesktop: bridge,
  } as unknown as Window & typeof globalThis
}

const CORRUPT: ArchiveCorruptionEntry = {
  type: 'note',
  recordId: 'n1',
  archivedAt: 1700000000000,
  data: '{"type":"note","note":',
  detectedAt: 1700000001000,
}

// ---------------------------------------------------------------------------
// local / web
// ---------------------------------------------------------------------------

test('the web build reads only localStorage, with no vault', async () => {
  installWindow(createFakeStorage())

  const snapshot = await readRecovery()

  assert.deepEqual(snapshot.payloads, [])
  assert.deepEqual(snapshot.archiveCorruption, [])
  assert.equal(snapshot.archiveUnavailable, false)
  assert.equal(hasRecovery(snapshot), false)
})

test('readLocalRecovery is the synchronous localStorage half', () => {
  installWindow(createFakeStorage({ [QUARANTINE_KEYS.notes]: 'broken' }))

  const snapshot = readLocalRecovery()

  assert.equal(snapshot.payloads.length, 1)
  assert.equal(snapshot.payloads[0].storageKey, QUARANTINE_KEYS.notes)
  assert.deepEqual(snapshot.archiveCorruption, [])
  assert.equal(hasRecovery(snapshot), true)
})

// ---------------------------------------------------------------------------
// desktop vault
// ---------------------------------------------------------------------------

test('the vault is folded in verbatim', async () => {
  installWindow(createFakeStorage({ [QUARANTINE_KEYS.archive]: '[]' }))
  const bridge: DesktopRecoveryBridge = {
    archiveCorruption: async () => ({ ok: true, value: [CORRUPT] }),
  }

  const snapshot = await readRecovery(bridge)

  assert.equal(snapshot.payloads.length, 1)
  assert.deepEqual(snapshot.archiveCorruption, [CORRUPT])
  assert.equal(snapshot.archiveUnavailable, false)
})

test('a vault that cannot be read is reported as unknown, not empty', async () => {
  installWindow(createFakeStorage())
  const bridge: DesktopRecoveryBridge = {
    archiveCorruption: async () => ({ ok: false, kind: 'unavailable' }),
  }

  const snapshot = await readRecovery(bridge)

  assert.deepEqual(snapshot.archiveCorruption, [])
  assert.equal(snapshot.archiveUnavailable, true)
  assert.equal(hasRecovery(snapshot), true)
})

test('a rejecting vault read is also unknown, never a thrown error', async () => {
  installWindow(createFakeStorage())
  const bridge: DesktopRecoveryBridge = {
    archiveCorruption: async () => {
      throw new Error('ipc gone')
    },
  }

  const snapshot = await readRecovery(bridge)

  assert.equal(snapshot.archiveUnavailable, true)
})

// ---------------------------------------------------------------------------
// export document
// ---------------------------------------------------------------------------

test('the export carries both sources, verbatim, at the current version', () => {
  const payloads = [
    { collection: 'notes', label: 'Notes', storageKey: QUARANTINE_KEYS.notes, payload: '{"a":' },
  ]

  const document = JSON.parse(
    buildRecoveryExport(payloads, { exportedAt: '2026-01-01T00:00:00.000Z', appVersion: '0.1.0' }, [
      CORRUPT,
    ]),
  )

  assert.equal(document.formatVersion, RECOVERY_EXPORT_FORMAT_VERSION)
  assert.equal(RECOVERY_EXPORT_FORMAT_VERSION, 2)
  assert.equal(document.payloadCount, 1)
  assert.equal(document.archiveCorruptionCount, 1)
  assert.deepEqual(document.payloads[0].payload, '{"a":')
  assert.deepEqual(document.archiveCorruption[0], CORRUPT)
})

test('the export omits the vault cleanly when there is none', () => {
  const document = JSON.parse(
    buildRecoveryExport([], { exportedAt: '2026-01-01T00:00:00.000Z', appVersion: '0.1.0' }),
  )

  assert.equal(document.archiveCorruptionCount, 0)
  assert.deepEqual(document.archiveCorruption, [])
})
