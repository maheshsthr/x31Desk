// Focused tests for unreadable-data recovery:
//   * `quarantine` — detection of preserved payloads, exact byte preservation,
//     export generation and empty-quarantine behaviour.
//   * `noteRepository` — that a reader quarantines under the same shared key the
//     recovery lookup reads, so the two can never drift apart.
//
// Dependency-free: Node's built-in test runner and type stripping only.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createLocalNoteRepository } from '@/data/noteRepository'
import {
  buildRecoveryExport,
  hasQuarantinedData,
  preserveUnreadable,
  QUARANTINE_KEYS,
  readQuarantinedPayloads,
  RECOVERY_EXPORT_FORMAT,
  RECOVERY_EXPORT_FORMAT_VERSION,
  recoveryExportFilename,
} from '@/data/quarantine'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function createFakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))

  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value))
    },
    removeItem: (key) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
    dump: () => Object.fromEntries(map),
  }
}

function installStorage(initial) {
  const storage = createFakeStorage(initial)
  globalThis.window = { localStorage: storage }
  return storage
}

/** Storage that throws on every access, as a hardened browser would. */
function installUnavailableStorage() {
  globalThis.window = {
    localStorage: {
      getItem() {
        throw new Error('storage unavailable')
      },
      setItem() {
        throw new Error('storage unavailable')
      },
      removeItem() {
        throw new Error('storage unavailable')
      },
    },
  }
}

// ---------------------------------------------------------------------------
// detection
// ---------------------------------------------------------------------------

test('an empty workspace reports no quarantined data', () => {
  installStorage()

  assert.deepEqual(readQuarantinedPayloads(), [])
  assert.equal(hasQuarantinedData(), false)
})

test('every quarantined collection is detected, in registry order', () => {
  installStorage({
    [QUARANTINE_KEYS.tasks]: '["broken"',
    [QUARANTINE_KEYS.notes]: '{"id":"n1",',
  })

  const found = readQuarantinedPayloads()

  assert.equal(found.length, 2)
  assert.deepEqual(
    found.map((entry) => entry.collection),
    ['notes', 'tasks'],
  )
  assert.equal(found[0].storageKey, QUARANTINE_KEYS.notes)
  assert.equal(found[0].label, 'Notes')
  assert.equal(found[1].storageKey, QUARANTINE_KEYS.tasks)
  assert.equal(found[1].label, 'Tasks')
  assert.equal(hasQuarantinedData(), true)
})

test('a quarantine key outside the known collections is still detected', () => {
  installStorage({ 'x31desk:bookmarks:unreadable': '{"oops":' })

  const found = readQuarantinedPayloads()

  assert.equal(found.length, 1)
  assert.equal(found[0].storageKey, 'x31desk:bookmarks:unreadable')
  assert.equal(found[0].collection, 'bookmarks')
  assert.equal(found[0].label, 'Bookmarks')
  assert.equal(found[0].payload, '{"oops":')
  assert.equal(hasQuarantinedData(), true)
})

test('a crafted key cannot resolve an inherited property as a label', () => {
  installStorage({ 'x31desk:constructor:unreadable': 'x' })

  const found = readQuarantinedPayloads()

  assert.equal(found.length, 1)
  assert.equal(found[0].collection, 'constructor')
  assert.equal(found[0].label, 'Constructor')
})

test('ordinary x31desk keys are never mistaken for quarantined data', () => {
  installStorage({
    'x31desk:notes': '[]',
    'x31desk:theme': 'dark',
    'x31desk:schema': '1',
    x31deskNotScoped: 'noise',
  })

  assert.deepEqual(readQuarantinedPayloads(), [])
})

test('a blank or absent quarantine key is not treated as recoverable data', () => {
  installStorage({ [QUARANTINE_KEYS.archive]: '' })

  assert.deepEqual(readQuarantinedPayloads(), [])
  assert.equal(hasQuarantinedData(), false)
})

test('unavailable storage reports no quarantined data instead of throwing', () => {
  installUnavailableStorage()

  assert.deepEqual(readQuarantinedPayloads(), [])
  assert.equal(hasQuarantinedData(), false)
})

// ---------------------------------------------------------------------------
// exact payload preservation
// ---------------------------------------------------------------------------

test('payloads are preserved byte-for-byte, without parsing or normalising', () => {
  // Not JSON, leading/trailing whitespace, a tab, and a non-ASCII character:
  // every one of these would change under a parse/stringify round trip.
  const raw = '  {"a":1}\n\tnot-json ✓ '
  installStorage({ [QUARANTINE_KEYS.snippets]: raw })

  assert.equal(readQuarantinedPayloads()[0].payload, raw)
})

test('preserveUnreadable keeps the first payload and never overwrites it', () => {
  const storage = installStorage()

  preserveUnreadable(QUARANTINE_KEYS.notes, 'first')
  preserveUnreadable(QUARANTINE_KEYS.notes, 'second')

  assert.equal(storage.getItem(QUARANTINE_KEYS.notes), 'first')
})

test('preserveUnreadable swallows a storage failure', () => {
  installUnavailableStorage()

  assert.doesNotThrow(() => preserveUnreadable(QUARANTINE_KEYS.notes, 'payload'))
})

test('a reader quarantines unreadable bytes under the shared recovery key', async () => {
  const raw = '{"id":"n1",' // truncated JSON
  const storage = installStorage({ 'x31desk:notes': raw })

  const repository = createLocalNoteRepository()

  // The workspace still opens, empty, rather than failing.
  assert.deepEqual(await repository.list(), [])
  assert.equal(storage.getItem(QUARANTINE_KEYS.notes), raw)

  const found = readQuarantinedPayloads()
  assert.equal(found.length, 1)
  assert.equal(found[0].payload, raw)
})

// ---------------------------------------------------------------------------
// export generation
// ---------------------------------------------------------------------------

test('the export carries metadata and the exact payloads', () => {
  const raw = '{"id":"n1",'
  installStorage({ [QUARANTINE_KEYS.notes]: raw })

  const exportedAt = '2026-10-15T09:30:00.000Z'
  const json = buildRecoveryExport(readQuarantinedPayloads(), {
    exportedAt,
    appVersion: '1.2.3',
  })
  const parsed = JSON.parse(json)

  assert.equal(parsed.format, RECOVERY_EXPORT_FORMAT)
  assert.equal(parsed.formatVersion, RECOVERY_EXPORT_FORMAT_VERSION)
  assert.equal(parsed.exportedAt, exportedAt)
  assert.equal(parsed.appVersion, '1.2.3')
  assert.equal(parsed.payloadCount, 1)
  assert.equal(parsed.payloads.length, 1)
  assert.equal(parsed.payloads[0].collection, 'notes')
  assert.equal(parsed.payloads[0].label, 'Notes')
  assert.equal(parsed.payloads[0].storageKey, QUARANTINE_KEYS.notes)
  // Round-tripping the document returns the payload unchanged.
  assert.equal(parsed.payloads[0].payload, raw)
})

test('an export preserves odd payloads exactly through a JSON round trip', () => {
  const raw = '  {"a":1}\n\tnot-json ✓ '
  installStorage({ [QUARANTINE_KEYS.snippets]: raw })

  const json = buildRecoveryExport(readQuarantinedPayloads(), {
    exportedAt: '2026-10-15T09:30:00.000Z',
    appVersion: '1.0.0',
  })

  assert.equal(JSON.parse(json).payloads[0].payload, raw)
})

test('an export with no payloads is still well-formed and empty', () => {
  installStorage()

  const json = buildRecoveryExport(readQuarantinedPayloads(), {
    exportedAt: '2026-10-15T09:30:00.000Z',
    appVersion: '1.0.0',
  })
  const parsed = JSON.parse(json)

  assert.equal(parsed.payloadCount, 0)
  assert.deepEqual(parsed.payloads, [])
})

test('the export filename is derived from the timestamp and is filesystem-safe', () => {
  assert.equal(
    recoveryExportFilename('2026-10-15T09:30:00.000Z'),
    'x31desk-recovery-2026-10-15T09-30-00-000Z.json',
  )
})
