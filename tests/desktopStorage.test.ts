// Choosing and binding the workspace store at startup.
// ---------------------------------------------------------------------------
// These tests pin the one decision that runs before any collection is read:
//
//   * a plain browser keeps the `localStorage` stores, untouched;
//   * the desktop shell rebinds all four stores to SQLite, but *only* after the
//     one-time import reports `completed`;
//   * a database that cannot be opened, or an import that cannot complete, is
//     reported as a failure and leaves the stores exactly where they were — so
//     the stale `localStorage` workspace is never shown as if it were current.
//
// They use an in-memory fake `localStorage` and a hand-built bridge, so nothing
// touches Electron, a database or the user's profile. The repository singletons
// are reset before each test, because the binding is process-wide by design.
//
// Dependency-free: Node's built-in test runner and type stripping.
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { archiveRepository } from '@/data/archiveRepository'
import { describeFailure } from '@/components/startup/failureCopy'
import {
  initializeWorkspaceStorage,
  mapMigrationFailure,
  resetWorkspaceRepositories,
} from '@/data/desktopStorage'
import type {
  MigrationOutcome,
  MigrationRecordCounts,
  MigrationStatusResult,
} from '@/data/ipc/contract'
import { noteRepository } from '@/data/noteRepository'
import { QUARANTINE_KEYS } from '@/data/quarantine'
import { snippetRepository } from '@/data/snippetRepository'
import { STORAGE_KEYS } from '@/data/storageKeys'
import { taskRepository } from '@/data/taskRepository'
import type { DesktopBridge } from '@/types/desktop'
import type { Note } from '@/types/note'

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
function installWindow(storage: FakeStorage, bridge?: DesktopBridge): void {
  globalThis.window = {
    localStorage: storage,
    x31deskDesktop: bridge,
  } as unknown as Window & typeof globalThis
}

const ZERO_COUNTS: MigrationRecordCounts = { notes: 0, tasks: 0, snippets: 0, archive: 0 }

/** A note the bridge claims to hold, distinct from anything in `localStorage`. */
const BRIDGE_NOTE: Note = {
  id: 'remote',
  title: 'From SQLite',
  content: 'body',
  createdAt: 1,
  updatedAt: 1,
}

/** A note seeded into `localStorage`, to prove reads are still local. */
const LOCAL_NOTE: Note = {
  id: 'local',
  title: 'From localStorage',
  content: 'body',
  createdAt: 2,
  updatedAt: 2,
}

type BridgeCalls = {
  notesList: number
  tasksList: number
  snippetsList: number
  archiveList: number
  status: number
  import: number
}

/** Builds a bridge whose repository reads are counted and clearly non-local. */
function createBridge(options: {
  status?: MigrationStatusResult
  outcome?: MigrationOutcome
} = {}): { bridge: DesktopBridge; calls: BridgeCalls } {
  const calls: BridgeCalls = {
    notesList: 0,
    tasksList: 0,
    snippetsList: 0,
    archiveList: 0,
    status: 0,
    import: 0,
  }

  const status: MigrationStatusResult =
    options.status ?? { status: 'completed', completedAt: 1, counts: ZERO_COUNTS }

  const bridge = {
    isDesktop: true,
    getAppInfo: async () => ({
      appVersion: '0.0.0',
      electron: '0',
      chrome: '0',
      node: '0',
      platform: 'test',
    }),
    notes: {
      list: async () => {
        calls.notesList += 1
        return { ok: true, value: [BRIDGE_NOTE] }
      },
      create: async () => ({ ok: true, value: BRIDGE_NOTE }),
      update: async () => ({ ok: true, value: null }),
      insert: async () => ({ ok: true, value: BRIDGE_NOTE }),
      remove: async () => ({ ok: true, value: undefined }),
      clear: async () => ({ ok: true, value: undefined }),
    },
    tasks: {
      list: async () => {
        calls.tasksList += 1
        return { ok: true, value: [] }
      },
      create: async () => ({ ok: true, value: null }),
      update: async () => ({ ok: true, value: null }),
      setCompleted: async () => ({ ok: true, value: null }),
      insert: async () => ({ ok: true, value: null }),
      remove: async () => ({ ok: true, value: undefined }),
      clear: async () => ({ ok: true, value: undefined }),
    },
    snippets: {
      list: async () => {
        calls.snippetsList += 1
        return { ok: true, value: [] }
      },
      create: async () => ({ ok: true, value: null }),
      update: async () => ({ ok: true, value: null }),
      insert: async () => ({ ok: true, value: null }),
      remove: async () => ({ ok: true, value: undefined }),
      clear: async () => ({ ok: true, value: undefined }),
    },
    archive: {
      list: async () => {
        calls.archiveList += 1
        return { ok: true, value: [] }
      },
      add: async () => ({ ok: true, value: null }),
      remove: async () => ({ ok: true, value: undefined }),
      clear: async () => ({ ok: true, value: undefined }),
    },
    recovery: {
      archiveCorruption: async () => ({ ok: true, value: [] }),
    },
    migration: {
      status: async () => {
        calls.status += 1
        return status
      },
      import: async () => {
        calls.import += 1
        return options.outcome ?? { outcome: 'completed', counts: ZERO_COUNTS, alreadyCompleted: false }
      },
    },
    lifecycle: {
      onFlushRequest: () => () => {},
      reportFlushResult: async () => {},
    },
  } as unknown as DesktopBridge

  return { bridge, calls }
}

beforeEach(() => {
  resetWorkspaceRepositories()
})

// ---------------------------------------------------------------------------
// web mode
// ---------------------------------------------------------------------------

test('a plain browser keeps the local stores and binds nothing', async () => {
  installWindow(createFakeStorage({ [STORAGE_KEYS.notes]: JSON.stringify([LOCAL_NOTE]) }))

  const report = await initializeWorkspaceStorage()

  assert.deepEqual(report, { ok: true, backend: 'local' })
  assert.deepEqual(await noteRepository.list(), [LOCAL_NOTE])
})

test('the bridge is read from window when none is injected', async () => {
  const { bridge, calls } = createBridge()
  installWindow(createFakeStorage(), bridge)

  const report = await initializeWorkspaceStorage()

  assert.equal(report.ok, true)
  assert.equal(calls.status, 1)
})

// ---------------------------------------------------------------------------
// desktop binding
// ---------------------------------------------------------------------------

test('a completed import binds all four stores to SQLite', async () => {
  const { bridge, calls } = createBridge()
  installWindow(
    createFakeStorage({ [STORAGE_KEYS.notes]: JSON.stringify([LOCAL_NOTE]) }),
    bridge,
  )

  const report = await initializeWorkspaceStorage()

  assert.equal(report.ok, true)
  if (!report.ok) {
    return
  }

  assert.equal(report.backend, 'sqlite')

  // Every store now reads through the bridge, not `localStorage`.
  assert.deepEqual(await noteRepository.list(), [BRIDGE_NOTE])
  await taskRepository.list()
  await snippetRepository.list()
  await archiveRepository.list()

  assert.equal(calls.notesList, 1)
  assert.equal(calls.tasksList, 1)
  assert.equal(calls.snippetsList, 1)
  assert.equal(calls.archiveList, 1)
})

test('an import that runs also binds once it reports completion', async () => {
  const { bridge, calls } = createBridge({
    status: { status: 'not-started' },
    outcome: { outcome: 'completed', counts: ZERO_COUNTS, alreadyCompleted: false },
  })
  installWindow(createFakeStorage(), bridge)

  const report = await initializeWorkspaceStorage()

  assert.equal(report.ok, true)
  assert.equal(calls.import, 1)
  assert.deepEqual(await noteRepository.list(), [BRIDGE_NOTE])
})

// ---------------------------------------------------------------------------
// failure — never a silent fallback
// ---------------------------------------------------------------------------

test('an unavailable database fails and leaves the local stores in place', async () => {
  const { bridge, calls } = createBridge({ status: { status: 'unavailable' } })
  installWindow(
    createFakeStorage({ [STORAGE_KEYS.notes]: JSON.stringify([LOCAL_NOTE]) }),
    bridge,
  )

  const report = await initializeWorkspaceStorage()

  assert.equal(report.ok, false)
  if (report.ok) {
    return
  }

  assert.deepEqual(report.failure, { reason: 'database-unavailable' })
  // The stores are untouched: the read is still local and never reached the bridge.
  assert.deepEqual(await noteRepository.list(), [LOCAL_NOTE])
  assert.equal(calls.notesList, 0)
})

test('a rejected status call is a failure, not a fallback to localStorage', async () => {
  const { bridge } = createBridge()
  bridge.migration.status = async () => {
    throw new Error('no shell')
  }
  installWindow(
    createFakeStorage({ [STORAGE_KEYS.notes]: JSON.stringify([LOCAL_NOTE]) }),
    bridge,
  )

  const report = await initializeWorkspaceStorage()

  assert.equal(report.ok, false)
  assert.deepEqual(await noteRepository.list(), [LOCAL_NOTE])
})

test('an import conflict fails and does not bind', async () => {
  const { bridge, calls } = createBridge({
    status: { status: 'not-started' },
    outcome: { outcome: 'conflict', conflicts: [{ collection: 'notes', id: 'n1' }] },
  })
  installWindow(
    createFakeStorage({ [STORAGE_KEYS.notes]: JSON.stringify([LOCAL_NOTE]) }),
    bridge,
  )

  const report = await initializeWorkspaceStorage()

  assert.equal(report.ok, false)
  if (report.ok) {
    return
  }

  assert.deepEqual(report.failure, {
    reason: 'import-conflict',
    conflicts: [{ collection: 'notes', id: 'n1' }],
  })
  assert.equal(calls.notesList, 0)
})

test('an unreadable collection fails as invalid and preserves its bytes', async () => {
  const storage = createFakeStorage({ [STORAGE_KEYS.notes]: 'not json' })
  const { bridge } = createBridge({ status: { status: 'not-started' } })
  installWindow(storage, bridge)

  const report = await initializeWorkspaceStorage()

  assert.equal(report.ok, false)
  if (report.ok) {
    return
  }

  assert.deepEqual(report.failure, { reason: 'import-invalid', collections: ['notes'] })
  // The unreadable bytes were preserved, not deleted, and the collection is intact.
  assert.equal(storage.dump()[QUARANTINE_KEYS.notes], 'not json')
  assert.equal(storage.dump()[STORAGE_KEYS.notes], 'not json')
})

test('a verification failure is reported distinctly', async () => {
  const { bridge } = createBridge({
    status: { status: 'not-started' },
    outcome: { outcome: 'verification-failed' },
  })
  installWindow(createFakeStorage(), bridge)

  const report = await initializeWorkspaceStorage()

  assert.equal(report.ok, false)
  if (report.ok) {
    return
  }

  assert.deepEqual(report.failure, { reason: 'import-verification' })
})

// ---------------------------------------------------------------------------
// failure mapping
// ---------------------------------------------------------------------------

test('every migration failure maps to a startup failure', () => {
  assert.deepEqual(mapMigrationFailure({ reason: 'invalid-source', collections: ['tasks'] }), {
    reason: 'import-invalid',
    collections: ['tasks'],
  })
  assert.deepEqual(
    mapMigrationFailure({ reason: 'conflict', conflicts: [{ collection: 'archive', id: 'note:n1' }] }),
    { reason: 'import-conflict', conflicts: [{ collection: 'archive', id: 'note:n1' }] },
  )
  assert.deepEqual(mapMigrationFailure({ reason: 'verification-failed' }), {
    reason: 'import-verification',
  })
  assert.deepEqual(mapMigrationFailure({ reason: 'storage', kind: 'unavailable' }), {
    reason: 'database-unavailable',
  })
  assert.deepEqual(mapMigrationFailure({ reason: 'storage', kind: 'quota' }), {
    reason: 'storage',
    kind: 'quota',
  })
})

test('every startup failure reason has non-empty copy', () => {
  const failures = [
    { reason: 'database-unavailable' },
    { reason: 'import-invalid', collections: ['notes', 'tasks'] },
    { reason: 'import-conflict', conflicts: [{ collection: 'notes', id: 'n1' }] },
    { reason: 'import-verification' },
    { reason: 'storage', kind: 'quota' },
    { reason: 'storage', kind: 'unknown' },
  ] as const

  for (const failure of failures) {
    const copy = describeFailure(failure)

    assert.ok(copy.title.length > 0, `${failure.reason} has no title`)
    assert.ok(copy.message.length > 0, `${failure.reason} has no message`)
  }

  // The specific reasons name what was involved.
  assert.deepEqual(describeFailure({ reason: 'import-invalid', collections: ['notes'] }).detail, [
    'Notes',
  ])
  assert.deepEqual(
    describeFailure({ reason: 'import-conflict', conflicts: [{ collection: 'notes', id: 'n1' }] })
      .detail,
    ['Notes · n1'],
  )
})
