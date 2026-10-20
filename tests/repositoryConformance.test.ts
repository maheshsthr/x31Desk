// Shared conformance tests for the two storage backends.
// ---------------------------------------------------------------------------
// Each scenario below is written once, against the repository *interface*, and
// then run twice: against the `localStorage` adapter the application uses today
// and against the SQLite adapter the main process will use after the switch.
// The point is that the SQLite adapter is not merely "close enough" — it must
// honour the same create/update/insert/remove/clear semantics, the same
// defaults and timestamps, the same tag handling and the same upsert-by-key
// behaviour the application already relies on.
//
// Where the two backends genuinely differ, the scenario deliberately does not
// assert the difference; those cases are recorded in the report and in
// `electron/README.md`:
//
//   * physical `list()` order — `localStorage` keeps collection order (a new
//     record appends, an upsert keeps its slot) while SQLite orders archive rows
//     by `archived_at DESC`. Ordering is a presentation concern (the UI sorts),
//     so only the cases where both agree are asserted;
//   - corruption handling — the `localStorage` readers quarantine invalid
//     entries; the SQLite archive preserves them in the corruption vault
//     (covered by `archiveCorruption.test.ts`, not here).
//
// These run under plain Node: the `localStorage` adapters are pointed at a fake
// storage, and the SQLite adapter at a throwaway database in the OS temp
// directory. No test touches the user's profile.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { createLocalArchiveRepository } from '@/data/archiveRepository'
import { createLocalNoteRepository } from '@/data/noteRepository'
import type {
  ArchiveRepository,
  NoteRepository,
  SnippetRepository,
  TaskRepository,
} from '@/data/repositoryTypes'
import { createLocalSnippetRepository } from '@/data/snippetRepository'
import { createLocalTaskRepository } from '@/data/taskRepository'
import type { ArchivedItem } from '@/types/archive'

import { initializeDatabase, type AppDatabase } from '../electron/db/database.ts'
import { createSqliteArchiveRepository } from '../electron/db/repositories/archiveRepository.ts'
import { createSqliteNoteRepository } from '../electron/db/repositories/noteRepository.ts'
import { createSqliteSnippetRepository } from '../electron/db/repositories/snippetRepository.ts'
import { createSqliteTaskRepository } from '../electron/db/repositories/taskRepository.ts'

let root: string

before(() => {
  root = mkdtempSync(join(tmpdir(), 'x31desk-conformance-'))
})

after(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A minimal `localStorage` for the renderer adapters. */
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
  }
}

function installStorage(initial = {}) {
  globalThis.window = { localStorage: createFakeStorage(initial) }
}

/**
 * Runs one scenario against a fresh `localStorage` store and a fresh SQLite
 * database, so the same assertions must hold for both.
 */
async function runBoth<TRepository>(
  name: string,
  createLocal: () => TRepository,
  createSqlite: (database: AppDatabase) => TRepository,
  scenario: (repository: TRepository) => Promise<void>,
): Promise<void> {
  installStorage()
  await scenario(createLocal())

  const database = initializeDatabase(join(root, name))

  try {
    await scenario(createSqlite(database))
  } finally {
    database.close()
  }
}

// ---------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------

async function noteConformance(repository: NoteRepository): Promise<void> {
  assert.deepEqual(await repository.list(), [])

  const first = await repository.create()

  assert.ok(first.id.length > 0)
  assert.equal(first.title, '')
  assert.equal(first.content, '')
  assert.ok(Number.isFinite(first.createdAt))
  assert.equal(first.createdAt, first.updatedAt)
  assert.deepEqual(await repository.list(), [first])

  const second = await repository.create()

  assert.deepEqual(
    (await repository.list()).map((note) => note.id),
    [first.id, second.id],
  )

  const updated = await repository.update(first.id, { title: 'Edited', content: 'Body' })

  assert.ok(updated)
  assert.equal(updated.id, first.id)
  assert.equal(updated.title, 'Edited')
  assert.equal(updated.content, 'Body')
  // The store owns createdAt: an edit must not move it.
  assert.equal(updated.createdAt, first.createdAt)
  assert.ok(updated.updatedAt >= first.createdAt)

  // Editing a record that is gone resolves null rather than throwing.
  assert.equal(await repository.update('missing', { title: '', content: '' }), null)

  const restored = { id: 'restored', title: 'Kept', content: 'Verbatim', createdAt: 5, updatedAt: 7 }

  assert.deepEqual(await repository.insert(restored), restored)
  assert.deepEqual(
    (await repository.list()).find((note) => note.id === 'restored'),
    restored,
  )

  // insert is an upsert by id, so restoring twice cannot duplicate.
  await repository.insert({ ...restored, title: 'Replaced' })

  const afterUpsert = await repository.list()
  assert.equal(afterUpsert.filter((note) => note.id === 'restored').length, 1)
  assert.equal(afterUpsert.find((note) => note.id === 'restored')?.title, 'Replaced')

  // Removal is idempotent.
  await repository.remove('missing')
  await repository.remove('restored')
  assert.ok(!(await repository.list()).some((note) => note.id === 'restored'))

  await repository.clear()
  assert.deepEqual(await repository.list(), [])
}

test('notes behave identically on both backends', async () => {
  await runBoth(
    'conformance-notes',
    createLocalNoteRepository,
    (database) => createSqliteNoteRepository(database.connection),
    noteConformance,
  )
})

// ---------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------

async function taskConformance(repository: TaskRepository) {
  assert.deepEqual(await repository.list(), [])

  const draft = { title: 'Ship', description: 'D', dueDate: '2026-10-14', priority: 'high' }
  const created = await repository.create(draft)

  assert.ok(created.id.length > 0)
  assert.equal(created.title, 'Ship')
  assert.equal(created.description, 'D')
  assert.equal(created.dueDate, '2026-10-14')
  assert.equal(created.priority, 'high')
  // A new task starts open, with no completion instant.
  assert.equal(created.completed, false)
  assert.equal(created.completedAt, null)
  assert.equal(created.createdAt, created.updatedAt)

  const done = await repository.setCompleted(created.id, true)
  assert.equal(done?.completed, true)
  assert.equal(typeof done?.completedAt, 'number')

  // update edits the record but leaves completion state alone.
  const edited = await repository.update(created.id, {
    ...{ title: 'Edited', description: 'D2', dueDate: null, priority: 'low' },
  })

  assert.ok(edited)
  assert.equal(edited.title, 'Edited')
  assert.equal(edited.description, 'D2')
  assert.equal(edited.dueDate, null)
  assert.equal(edited.priority, 'low')
  assert.equal(edited.completed, true)
  assert.equal(edited.completedAt, done?.completedAt)
  assert.equal(edited.createdAt, created.createdAt)

  const reopened = await repository.setCompleted(created.id, false)
  assert.equal(reopened?.completed, false)
  assert.equal(reopened?.completedAt, null)

  assert.equal(await repository.update('missing', { title: '', description: '', dueDate: null, priority: 'medium' }), null)
  assert.equal(await repository.setCompleted('missing', true), null)

  const restored = {
    id: 'restored',
    title: 'Kept',
    description: '',
    dueDate: null,
    priority: 'medium',
    completed: true,
    createdAt: 5,
    updatedAt: 7,
    completedAt: 7,
  }

  assert.deepEqual(await repository.insert(restored), restored)
  assert.deepEqual(
    (await repository.list()).find((task) => task.id === 'restored'),
    restored,
  )

  await repository.insert({ ...restored, title: 'Replaced', completed: false, completedAt: null })

  const afterUpsert = await repository.list()
  assert.equal(afterUpsert.filter((task) => task.id === 'restored').length, 1)
  assert.equal(afterUpsert.find((task) => task.id === 'restored')?.title, 'Replaced')
  assert.equal(afterUpsert.find((task) => task.id === 'restored')?.completed, false)

  await repository.remove('missing')
  await repository.remove('restored')
  assert.ok(!(await repository.list()).some((task) => task.id === 'restored'))

  await repository.clear()
  assert.deepEqual(await repository.list(), [])
}

test('tasks conform across both backends', async () => {
  await runBoth(
    'conformance-tasks',
    createLocalTaskRepository,
    (database) => createSqliteTaskRepository(database.connection),
    taskConformance,
  )
})

// ---------------------------------------------------------------------------
// snippets
// ---------------------------------------------------------------------------

async function snippetConformance(repository: SnippetRepository) {
  assert.deepEqual(await repository.list(), [])

  // The draft's tag field is raw text; both backends parse it identically:
  // trimmed, empties dropped, duplicates removed case-insensitively.
  const created = await repository.create({
    title: 'T',
    code: 'c',
    language: 'typescript',
    tags: 'b, a, A, ',
  })

  assert.ok(created.id.length > 0)
  assert.deepEqual(created.tags, ['b', 'a'])
  assert.equal(created.createdAt, created.updatedAt)

  const updated = await repository.update(created.id, {
    title: 'T2',
    code: 'c2',
    language: 'json',
    tags: 'new, tag',
  })

  assert.deepEqual(updated?.tags, ['new', 'tag'])
  assert.equal(updated?.language, 'json')
  assert.equal(updated?.createdAt, created.createdAt)

  assert.equal(
    await repository.update('missing', { title: 'T', code: 'c', language: 'plaintext', tags: '' }),
    null,
  )

  await repository.clear()
  assert.deepEqual(await repository.list(), [])

  // Tag *order* is meaningful and must survive a write/read cycle.
  const restored = {
    id: 'restored',
    title: 'Kept',
    code: 'verbatim',
    language: 'bash',
    tags: ['z', 'y', 'x'],
    createdAt: 5,
    updatedAt: 7,
  }

  assert.deepEqual(await repository.insert(restored), restored)
  assert.deepEqual((await repository.list())[0]?.tags, ['z', 'y', 'x'])

  // insert is an upsert, and it replaces the whole tag set.
  await repository.insert({ ...restored, tags: [] })

  const afterUpsert = await repository.list()
  assert.equal(afterUpsert.length, 1)
  assert.deepEqual(afterUpsert[0]?.tags, [])

  await repository.remove('restored')
  assert.deepEqual(await repository.list(), [])

  await repository.create({ title: 'T', code: 'c', language: 'plaintext', tags: '' })
  await repository.clear()
  assert.deepEqual(await repository.list(), [])
}

test('snippets conform across both backends', async () => {
  await runBoth(
    'conformance-snippets',
    createLocalSnippetRepository,
    (database) => createSqliteSnippetRepository(database.connection),
    snippetConformance,
  )
})

// ---------------------------------------------------------------------------
// archive
// ---------------------------------------------------------------------------

function archivedNote(id: string, title: string, archivedAt: number): ArchivedItem {
  return {
    type: 'note',
    archivedAt,
    note: { id, title, content: `${title} body`, createdAt: 1, updatedAt: 1 },
  }
}

function archivedTask(id: string, title: string, archivedAt: number): ArchivedItem {
  return {
    type: 'task',
    archivedAt,
    task: {
      id,
      title,
      description: '',
      dueDate: null,
      priority: 'medium',
      completed: false,
      createdAt: 1,
      updatedAt: 1,
      completedAt: null,
    },
  }
}

async function archiveConformance(repository: ArchiveRepository) {
  assert.deepEqual(await repository.list(), [])

  const first = archivedNote('n1', 'A', 100)

  assert.deepEqual(await repository.add(first), first)
  assert.deepEqual(await repository.list(), [first])

  // Distinct entries, added in ascending archivedAt order: both backends present
  // the most recently set-aside first.
  const second = archivedTask('t1', 'B', 200)

  await repository.add(second)
  assert.deepEqual(
    (await repository.list()).map((item) => item.type),
    ['task', 'note'],
  )

  // remove addresses exactly one entry; a missing one is not an error.
  await repository.remove('note', 'n1')
  await repository.remove('note', 'missing')
  assert.deepEqual(await repository.list(), [second])

  // add is an upsert keyed by (kind, id), so restoring twice cannot duplicate.
  const third = archivedNote('n1', 'C', 300)

  await repository.add(third)
  await repository.add(third)

  const list = await repository.list()
  assert.equal(list.length, 2)
  assert.deepEqual(
    list.find((item) => item.type === 'note'),
    third,
  )

  // A note and a task may legitimately share one record id.
  await repository.add(archivedTask('n1', 'D', 400))
  assert.deepEqual(
    (await repository.list())
      .map((item) => item.type)
      .sort(),
    ['note', 'task', 'task'],
  )

  await repository.clear()
  assert.deepEqual(await repository.list(), [])
}

test('archive conforms across both backends', async () => {
  await runBoth(
    'conformance-archive',
    createLocalArchiveRepository,
    (database) => createSqliteArchiveRepository(database.connection),
    archiveConformance,
  )
})

/**
 * An ordering the two backends genuinely agree on, tie included.
 *
 * The backends build their physical order differently — `localStorage` prepends,
 * SQLite orders `archived_at DESC, rowid DESC` — so they only coincide when the
 * records were set aside in ascending `archivedAt` order. Under that condition,
 * which is exactly what `archiveStore.add` produces in practice, both present
 * newest-first, and both resolve a same-millisecond tie to the more recently
 * added record.
 *
 * This is the invariant `selectArchivedItems` leans on for its stable sort, so
 * it is pinned here against both real backends: if either changed its tie-break,
 * the archive would silently re-order when the bindings switch to SQLite.
 */
async function archiveOrderConformance(repository: ArchiveRepository) {
  await repository.add(archivedNote('a', 'First', 200))
  // Same millisecond as the previous record: the tie.
  await repository.add(archivedNote('b', 'Second', 200))
  await repository.add(archivedNote('c', 'Third', 300))

  assert.deepEqual(
    (await repository.list()).map((item) => (item.type === 'note' ? item.note.id : '?')),
    ['c', 'b', 'a'],
  )
}

test('archive order matches across both backends, tie included', async () => {
  await runBoth(
    'conformance-archive-order',
    createLocalArchiveRepository,
    (database) => createSqliteArchiveRepository(database.connection),
    archiveOrderConformance,
  )
})
