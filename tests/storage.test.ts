// Focused tests for the storage safeguards added for the Electron prep:
//   * `readStable` — the guard that keeps a pending load from overwriting a
//     newer in-memory change once repository reads become asynchronous.
//   * `schema` — workspace schema versioning, including unversioned workspaces.
//   * `taskStore` / `archiveStore` — that the guard is wired into the real
//     stores, using their existing injected-repository seam.
//
// Dependency-free: Node's built-in test runner and type stripping only.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createArchiveStore } from '@/data/archiveStore'
import { readStable } from '@/data/readStable'
import {
  CURRENT_SCHEMA_VERSION,
  ensureWorkspaceSchema,
  readSchemaVersion,
  SCHEMA_STORAGE_KEY,
  UNVERSIONED_SCHEMA,
} from '@/data/schema'
import { createLocalSnippetRepository } from '@/data/snippetRepository'
import { createTaskStore } from '@/data/taskStore'
import { isSnippet } from '@/types/snippet'

// ---------------------------------------------------------------------------
// readStable
// ---------------------------------------------------------------------------

test('readStable applies a read when nothing changed while it was in flight', async () => {
  let calls = 0
  let applied: string | null = null

  await readStable(
    async () => {
      calls += 1
      return 'value'
    },
    () => 0,
    (value) => {
      applied = value
    },
  )

  assert.equal(applied, 'value')
  assert.equal(calls, 1)
})

test('readStable retries and applies the fresh read when a mutation lands mid-read', async () => {
  let revision = 0
  let calls = 0
  let applied: string | null = null

  await readStable(
    async () => {
      calls += 1

      if (calls === 1) {
        // A mutation commits while the first read is in flight.
        revision += 1
        return 'stale'
      }

      return 'fresh'
    },
    () => revision,
    (value) => {
      applied = value
    },
  )

  assert.equal(applied, 'fresh')
  assert.equal(calls, 2)
})

test('readStable applies a final read if mutations never settle', async () => {
  let revision = 0
  let calls = 0
  let applied = ''

  await readStable(
    async () => {
      calls += 1
      revision += 1
      return `read-${calls}`
    },
    () => revision,
    (value) => {
      applied = value
    },
    { maxAttempts: 3 },
  )

  // Three guarded attempts, then one unguarded final read.
  assert.equal(calls, 4)
  assert.equal(applied, 'read-4')
})

// ---------------------------------------------------------------------------
// schema versioning
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
    key: () => null,
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

test('a missing version marker reads as unversioned', () => {
  installStorage()

  assert.equal(readSchemaVersion(), UNVERSIONED_SCHEMA)
})

test('an unversioned workspace is adopted without rewriting its records', () => {
  const notes = JSON.stringify([{ id: 'n1', title: 'Kept' }])
  const tasks = JSON.stringify([{ id: 't1', title: 'Also kept' }])
  const storage = installStorage({
    'x31desk:notes': notes,
    'x31desk:tasks': tasks,
    // Unrelated preferences must be left alone too.
    'x31desk:theme': 'dark',
  })

  assert.equal(ensureWorkspaceSchema(), CURRENT_SCHEMA_VERSION)
  assert.equal(storage.getItem(SCHEMA_STORAGE_KEY), String(CURRENT_SCHEMA_VERSION))

  // The point of the migration: the marker appears, the records do not move.
  assert.equal(storage.getItem('x31desk:notes'), notes)
  assert.equal(storage.getItem('x31desk:tasks'), tasks)
  assert.equal(storage.getItem('x31desk:theme'), 'dark')
})

test('a current-version workspace is left untouched', () => {
  const storage = installStorage({ [SCHEMA_STORAGE_KEY]: '1' })

  assert.equal(ensureWorkspaceSchema(), CURRENT_SCHEMA_VERSION)
  assert.equal(storage.getItem(SCHEMA_STORAGE_KEY), '1')
})

test('a newer-version workspace is never downgraded or migrated', () => {
  // A workspace written by a future build must be left for that build.
  const storage = installStorage({ [SCHEMA_STORAGE_KEY]: '99' })

  assert.equal(ensureWorkspaceSchema(), 99)
  assert.equal(storage.getItem(SCHEMA_STORAGE_KEY), '99')
})

test('an unreadable marker is treated as unversioned, not as an error', () => {
  const storage = installStorage({ [SCHEMA_STORAGE_KEY]: 'not-a-number' })

  assert.equal(readSchemaVersion(), UNVERSIONED_SCHEMA)
  assert.equal(ensureWorkspaceSchema(), CURRENT_SCHEMA_VERSION)
  assert.equal(storage.getItem(SCHEMA_STORAGE_KEY), '1')
})

test('a fresh workspace is stamped without inventing collection keys', () => {
  const storage = installStorage()

  ensureWorkspaceSchema()

  assert.deepEqual(storage.dump(), { [SCHEMA_STORAGE_KEY]: '1' })
})

// ---------------------------------------------------------------------------
// task store race
// ---------------------------------------------------------------------------

function createDeferred() {
  let resolve
  const promise = new Promise((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function makeTask(id, title = 'Task') {
  return {
    id,
    title,
    notes: '',
    completed: false,
    createdAt: 1,
    updatedAt: 1,
    dueDate: null,
    completedAt: null,
  }
}

/**
 * A repository whose first `list()` is deferred — standing in for a slow,
 * asynchronous storage adapter — and which becomes immediate afterwards. The
 * deferred call captures the snapshot as it was when the load started.
 */
function createRacingTaskRepository(initial) {
  const stored = [...initial]
  const first = createDeferred()
  let pendingFirst = true

  return {
    stored,
    list() {
      if (pendingFirst) {
        pendingFirst = false
        return first.promise
      }

      return Promise.resolve([...stored])
    },
    async create(draft) {
      const task = makeTask(`t${stored.length + 1}`, draft.title ?? 'Task')
      stored.unshift(task)
      return task
    },
    async update(id, draft) {
      const task = stored.find((candidate) => candidate.id === id)
      if (!task) return null
      const updated = { ...task, ...draft, updatedAt: task.updatedAt + 1 }
      stored[stored.indexOf(task)] = updated
      return updated
    },
    async setCompleted() {
      return null
    },
    async insert(task) {
      if (!stored.some((candidate) => candidate.id === task.id)) stored.unshift(task)
      return task
    },
    async remove(id) {
      const index = stored.findIndex((candidate) => candidate.id === id)
      if (index >= 0) stored.splice(index, 1)
    },
    async clear() {
      stored.length = 0
    },
    resolveFirst: (value) => first.resolve(value),
  }
}

test('a task created while the first load is pending survives that load', async () => {
  const repository = createRacingTaskRepository([])
  const store = createTaskStore(repository)
  store.subscribe(() => {})

  const created = await store.createTask({ title: 'Written during load' })
  assert.ok(store.getSnapshot().tasks.some((task) => task.id === created.id))

  // The load now resolves with the snapshot it captured before the create.
  repository.resolveFirst([])
  await new Promise((resolve) => setTimeout(resolve, 0))

  const tasks = store.getSnapshot().tasks
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].id, created.id)
})

test('a task deleted while the first load is pending is not resurrected', async () => {
  const repository = createRacingTaskRepository([makeTask('t1', 'Doomed')])
  const store = createTaskStore(repository)
  store.subscribe(() => {})

  await store.deleteTask('t1')
  assert.equal(store.getSnapshot().tasks.length, 0)

  // The load resolves with the snapshot that still contains the deleted task.
  repository.resolveFirst([makeTask('t1', 'Doomed')])
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(store.getSnapshot().tasks.length, 0)
})

test('a mutation in the same tick as an immediate load is not clobbered', async () => {
  // Reproduces the load-vs-create ordering that a plain `.then(apply)` broke:
  // the load read is already "stable" when it resolves, but a mutation that
  // commits in the same tick must still land after it, not before.
  const stored = []
  const repository = {
    list: async () => [...stored],
    create: async () => {
      const task = makeTask(`t${stored.length + 1}`)
      stored.unshift(task)
      return task
    },
    update: async () => null,
    setCompleted: async () => null,
    insert: async (task) => task,
    remove: async () => {},
    clear: async () => {},
  }

  const store = createTaskStore(repository)
  store.subscribe(() => {})

  const created = await store.createTask({ title: 'Same tick' })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.ok(store.getSnapshot().tasks.some((task) => task.id === created.id))
})

// ---------------------------------------------------------------------------
// archive store race
// ---------------------------------------------------------------------------

/**
 * The archive store fans a move out across the collection it came from, so its
 * race has a second shape: a move that lands while the initial archive read is
 * still pending must not be undone by that read.
 */
function createArchiveHarness() {
  const archived = []
  const notes = []
  const first = createDeferred()
  let pendingFirst = true

  const archive = {
    async list() {
      if (pendingFirst) {
        pendingFirst = false
        return first.promise
      }

      return [...archived]
    },
    async add(entry) {
      archived.push(entry)
    },
    async remove(type, id) {
      const index = archived.findIndex(
        (entry) => entry.type === type && (entry.note?.id ?? entry.task?.id ?? entry.snippet?.id) === id,
      )
      if (index >= 0) archived.splice(index, 1)
    },
    async clear() {
      archived.length = 0
    },
    resolveFirst: (value) => first.resolve(value),
  }

  const noteRepository = {
    async insert(note) {
      if (!notes.some((candidate) => candidate.id === note.id)) notes.push(note)
    },
    async remove(id) {
      const index = notes.findIndex((candidate) => candidate.id === id)
      if (index >= 0) notes.splice(index, 1)
    },
  }

  const store = createArchiveStore({
    archive,
    notes: noteRepository,
    snippets: { insert: async () => {}, remove: async () => {} },
    tasks: { deleteTask: async () => true, restoreTask: async (task) => task },
  })

  return { store, archive, notes, resolveFirst: archive.resolveFirst }
}

test('a note archived while the archive load is pending is not undone by that load', async () => {
  const { store, notes, resolveFirst } = createArchiveHarness()
  store.subscribe(() => {})

  const note = { id: 'n1', title: 'Archive me', content: '', createdAt: 1, updatedAt: 1 }

  const archived = await store.archiveNote(note)
  assert.equal(archived, true)
  assert.equal(store.getSnapshot().items.length, 1)
  assert.equal(notes.length, 0)

  // The load now resolves with the archive as it was before the move.
  resolveFirst([])
  await new Promise((resolve) => setTimeout(resolve, 0))

  const items = store.getSnapshot().items
  assert.equal(items.length, 1)
  assert.equal(items[0].type, 'note')
  assert.equal(items[0].note.id, 'n1')
})

// ---------------------------------------------------------------------------
// snippet timestamp validation
// ---------------------------------------------------------------------------

function makeSnippet(overrides = {}) {
  return {
    id: 's1',
    title: 'Title',
    code: 'console.log(1)',
    language: 'plaintext',
    tags: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_500,
    ...overrides,
  }
}

test('isSnippet accepts finite timestamps, matching the other validators', () => {
  assert.equal(isSnippet(makeSnippet()), true)
  assert.equal(isSnippet(makeSnippet({ createdAt: 0, updatedAt: 1 })), true)
})

test('isSnippet rejects a non-finite or non-numeric timestamp', () => {
  assert.equal(isSnippet(makeSnippet({ createdAt: Number.NaN })), false)
  assert.equal(isSnippet(makeSnippet({ updatedAt: Number.POSITIVE_INFINITY })), false)
  assert.equal(isSnippet(makeSnippet({ createdAt: Number.NEGATIVE_INFINITY })), false)
  assert.equal(isSnippet(makeSnippet({ updatedAt: '1' })), false)
  assert.equal(isSnippet(makeSnippet({ createdAt: null })), false)
})

test('a repository read keeps valid snippets and rewrites nothing', async () => {
  const snippets = [makeSnippet()]
  const stored = JSON.stringify(snippets)
  const storage = installStorage({ 'x31desk:snippets': stored })

  const repository = createLocalSnippetRepository()
  const read = await repository.list()

  assert.equal(read.length, 1)
  assert.equal(read[0].id, 's1')

  // A valid snippet is neither quarantined nor rewritten.
  assert.equal(storage.getItem('x31desk:snippets:unreadable'), null)
  assert.equal(storage.getItem('x31desk:snippets'), stored)
})

test('a snippet whose timestamp overflows to Infinity is dropped and quarantined', async () => {
  // `1e999` parses to `Infinity`, which the old `typeof === 'number'` check let
  // through; the plain-text payload keeps that literal intact.
  const raw =
    '[{"id":"s1","title":"T","code":"x","language":"plaintext","tags":[],"createdAt":1e999,"updatedAt":1}]'
  const storage = installStorage({ 'x31desk:snippets': raw })

  const repository = createLocalSnippetRepository()

  assert.deepEqual(await repository.list(), [])
  assert.equal(storage.getItem('x31desk:snippets:unreadable'), raw)
})
