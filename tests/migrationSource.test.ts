// The one-time `localStorage` → SQLite import, renderer half.
// ---------------------------------------------------------------------------
// These tests cover the strict source reader and the state machine that drives
// the import. They use an in-memory fake `localStorage` installed as
// `window.localStorage` — never the user's real profile — and a fake bridge, so
// the behaviour under test is exactly the conversation the renderer has with the
// main process. They pin:
//
//   * a source read that refuses a malformed collection *as a whole* rather than
//     dropping records, and preserves the unreadable bytes (write-once);
//   * the explicit state machine — not-started / in-progress / completed /
//     failed — and that `completed` is only reached on the main process's word;
//   * web-only mode doing nothing at all;
//   * the original collection keys and every quarantine key left untouched;
//   * typed failures that never throw, even when the bridge itself rejects.
//
// Dependency-free: Node's built-in test runner and type stripping.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runStorageMigration, readMigrationSource } from '@/data/migration'
import { QUARANTINE_KEYS } from '@/data/quarantine'
import { STORAGE_KEYS } from '@/data/storageKeys'
import type { DesktopMigrationBridge } from '@/types/desktop'
import type { MigrationSource } from '@/data/ipc/contract'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type FakeStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
  key: (index: number) => string | null
  readonly length: number
  dump: () => Record<string, string>
}

function createFakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const map = new Map(Object.entries(initial))

  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
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

/** Installs a fake storage (and optionally a bridge) as the global `window`. */
function installWindow(storage: FakeStorage, bridge?: DesktopMigrationBridge): void {
  globalThis.window = {
    localStorage: storage,
    x31deskDesktop: bridge === undefined ? undefined : { migration: bridge },
  } as unknown as Window & typeof globalThis
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const NOTE = { id: 'n1', title: 'Note', content: 'Body', createdAt: 1000, updatedAt: 2000 }
const TASK = {
  id: 't1',
  title: 'Task',
  description: 'Details',
  dueDate: '2026-01-02',
  priority: 'high',
  completed: true,
  createdAt: 1000,
  updatedAt: 2000,
  completedAt: 2500,
}
const SNIPPET = {
  id: 's1',
  title: 'Snippet',
  code: 'const x = 1',
  language: 'typescript',
  tags: ['beta', 'alpha'],
  createdAt: 1000,
  updatedAt: 2000,
}
const ARCHIVE = { type: 'note', archivedAt: 5000, note: NOTE }

const EMPTY_SOURCE: MigrationSource = { notes: [], tasks: [], snippets: [], archive: [] }
const EMPTY_COUNTS = { notes: 0, tasks: 0, snippets: 0, archive: 0 }

/** A complete, valid workspace in `localStorage` form. */
function fullStorage(): Record<string, string> {
  return {
    [STORAGE_KEYS.notes]: JSON.stringify([NOTE]),
    [STORAGE_KEYS.tasks]: JSON.stringify([TASK]),
    [STORAGE_KEYS.snippets]: JSON.stringify([SNIPPET]),
    [STORAGE_KEYS.archive]: JSON.stringify([ARCHIVE]),
  }
}

/** A bridge whose two calls are overridable per test. */
function fakeBridge(overrides: Partial<DesktopMigrationBridge> = {}): DesktopMigrationBridge {
  return {
    status: async () => ({ status: 'not-started' }),
    import: async () => ({ outcome: 'completed', counts: EMPTY_COUNTS, alreadyCompleted: false }),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// the strict source reader
// ---------------------------------------------------------------------------

test('a workspace with no keys is read as four empty collections', () => {
  const storage = createFakeStorage()
  installWindow(storage)

  assert.deepEqual(readMigrationSource(storage), { ok: true, source: EMPTY_SOURCE })
})

test('explicit empty arrays are read as four empty collections', () => {
  const storage = createFakeStorage({
    [STORAGE_KEYS.notes]: '[]',
    [STORAGE_KEYS.tasks]: '[]',
    [STORAGE_KEYS.snippets]: '[]',
    [STORAGE_KEYS.archive]: '[]',
  })
  installWindow(storage)

  assert.deepEqual(readMigrationSource(storage), { ok: true, source: EMPTY_SOURCE })
})

test('a valid workspace is read back record for record', () => {
  const storage = createFakeStorage(fullStorage())
  installWindow(storage)

  assert.deepEqual(readMigrationSource(storage), {
    ok: true,
    source: { notes: [NOTE], tasks: [TASK], snippets: [SNIPPET], archive: [ARCHIVE] },
  })
})

test('a malformed collection fails the whole read and preserves its bytes', () => {
  const storage = createFakeStorage({ ...fullStorage(), [STORAGE_KEYS.notes]: '{not json' })
  installWindow(storage)

  const read = readMigrationSource(storage)

  assert.deepEqual(read, { ok: false, reason: 'invalid', collections: ['notes'] })
  assert.equal(storage.getItem(QUARANTINE_KEYS.notes), '{not json')
})

test('a collection with one invalid record fails the whole read and is preserved', () => {
  const storage = createFakeStorage({
    ...fullStorage(),
    [STORAGE_KEYS.tasks]: JSON.stringify([TASK, { id: 'broken' }]),
  })
  installWindow(storage)

  const read = readMigrationSource(storage)

  assert.deepEqual(read, { ok: false, reason: 'invalid', collections: ['tasks'] })
  assert.equal(storage.getItem(QUARANTINE_KEYS.tasks), JSON.stringify([TASK, { id: 'broken' }]))
})

test('a pre-existing quarantine payload is preserved, not replaced', () => {
  const original = 'the first corruption'
  const storage = createFakeStorage({
    ...fullStorage(),
    [STORAGE_KEYS.notes]: '{broken again',
    [QUARANTINE_KEYS.notes]: original,
  })
  installWindow(storage)

  readMigrationSource(storage)

  assert.equal(storage.getItem(QUARANTINE_KEYS.notes), original)
})

test('storage that cannot be read reports unavailable, not invalid', () => {
  globalThis.window = {
    localStorage: {
      getItem() {
        throw Object.assign(new Error('blocked'), { name: 'SecurityError' })
      },
    },
  } as unknown as Window & typeof globalThis

  assert.deepEqual(readMigrationSource(), { ok: false, reason: 'unavailable', kind: 'unavailable' })
})

// ---------------------------------------------------------------------------
// the state machine
// ---------------------------------------------------------------------------

test('a browser with no bridge does nothing and is not applicable', async () => {
  const storage = createFakeStorage(fullStorage())
  installWindow(storage)

  const report = await runStorageMigration()

  assert.equal(report.state, 'not-started')
  assert.equal(report.applicable, false)
  assert.deepEqual(storage.dump(), fullStorage())
})

test('a completed status is reported without importing again', async () => {
  const storage = createFakeStorage(fullStorage())
  let imported = false
  const bridge = fakeBridge({
    status: async () => ({ status: 'completed', completedAt: 42, counts: { notes: 1, tasks: 1, snippets: 1, archive: 1 } }),
    import: async () => {
      imported = true
      return { outcome: 'completed', counts: EMPTY_COUNTS, alreadyCompleted: false }
    },
  })
  installWindow(storage, bridge)

  const report = await runStorageMigration()

  assert.equal(report.state, 'completed')
  assert.equal(report.alreadyCompleted, true)
  assert.deepEqual(report.counts, { notes: 1, tasks: 1, snippets: 1, archive: 1 })
  assert.equal(imported, false)
})

test('an unavailable status fails with a storage failure', async () => {
  const storage = createFakeStorage(fullStorage())
  installWindow(storage, fakeBridge({ status: async () => ({ status: 'unavailable' }) }))

  const report = await runStorageMigration()

  assert.equal(report.state, 'failed')
  assert.deepEqual(report.failure, { reason: 'storage', kind: 'unavailable' })
})

test('a successful import reports completed with the main process counts', async () => {
  const storage = createFakeStorage(fullStorage())
  const bridge = fakeBridge({
    import: async () => ({ outcome: 'completed', counts: { notes: 1, tasks: 1, snippets: 1, archive: 1 }, alreadyCompleted: false }),
  })
  installWindow(storage, bridge)

  const report = await runStorageMigration()

  assert.equal(report.state, 'completed')
  assert.equal(report.alreadyCompleted, false)
  assert.deepEqual(report.counts, { notes: 1, tasks: 1, snippets: 1, archive: 1 })
})

test('the import is never offered a workspace with a malformed collection', async () => {
  const storage = createFakeStorage({ ...fullStorage(), [STORAGE_KEYS.snippets]: 'oops' })
  let offered = false
  const bridge = fakeBridge({
    import: async () => {
      offered = true
      return { outcome: 'completed', counts: EMPTY_COUNTS, alreadyCompleted: false }
    },
  })
  installWindow(storage, bridge)

  const report = await runStorageMigration()

  assert.equal(report.state, 'failed')
  assert.deepEqual(report.failure, { reason: 'invalid-source', collections: ['snippets'] })
  assert.equal(offered, false)
  assert.equal(storage.getItem(QUARANTINE_KEYS.snippets), 'oops')
})

test('a conflict outcome is surfaced with its conflicts', async () => {
  const storage = createFakeStorage(fullStorage())
  const conflicts = [{ collection: 'notes' as const, id: 'n1' }]
  installWindow(storage, fakeBridge({ import: async () => ({ outcome: 'conflict', conflicts }) }))

  const report = await runStorageMigration()

  assert.equal(report.state, 'failed')
  assert.deepEqual(report.failure, { reason: 'conflict', conflicts })
})

test('a verification failure is surfaced distinctly', async () => {
  const storage = createFakeStorage(fullStorage())
  installWindow(storage, fakeBridge({ import: async () => ({ outcome: 'verification-failed' }) }))

  const report = await runStorageMigration()

  assert.equal(report.state, 'failed')
  assert.deepEqual(report.failure, { reason: 'verification-failed' })
})

test('the state advances through in-progress to the terminal state', async () => {
  const storage = createFakeStorage(fullStorage())
  installWindow(storage, fakeBridge())

  const states: string[] = []
  await runStorageMigration({ onStateChange: (state) => states.push(state) })

  assert.deepEqual(states, ['in-progress', 'completed'])
})

test('a rejecting bridge is classified, never thrown', async () => {
  const storage = createFakeStorage(fullStorage())
  installWindow(
    storage,
    fakeBridge({
      status: async () => {
        throw Object.assign(new Error('full'), { name: 'QuotaExceededError' })
      },
    }),
  )

  const report = await runStorageMigration()

  assert.equal(report.state, 'failed')
  assert.deepEqual(report.failure, { reason: 'storage', kind: 'quota' })
})

test('a failing import call is classified, never thrown', async () => {
  const storage = createFakeStorage(fullStorage())
  installWindow(
    storage,
    fakeBridge({
      import: async () => {
        throw Object.assign(new Error('gone'), { name: 'SecurityError' })
      },
    }),
  )

  const report = await runStorageMigration()

  assert.equal(report.state, 'failed')
  assert.deepEqual(report.failure, { reason: 'storage', kind: 'unavailable' })
})

test('a run never writes to the collection keys', async () => {
  const storage = createFakeStorage(fullStorage())
  installWindow(storage, fakeBridge())

  await runStorageMigration()

  assert.deepEqual(storage.dump(), fullStorage())
})

test('an existing quarantine key is reported and left in place', async () => {
  const storage = createFakeStorage({
    ...fullStorage(),
    [QUARANTINE_KEYS.tasks]: 'older corruption',
  })
  installWindow(storage, fakeBridge())

  const report = await runStorageMigration()

  assert.deepEqual(report.quarantinedKeys, [QUARANTINE_KEYS.tasks])
  assert.equal(storage.getItem(QUARANTINE_KEYS.tasks), 'older corruption')
})
