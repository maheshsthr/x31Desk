// The one-time `localStorage` → SQLite import, main-process half.
// ---------------------------------------------------------------------------
// These tests exercise `importWorkspace`, the completion marker in `meta` and
// the migration IPC handlers against a throwaway database in the OS temp
// directory — never the user's profile. They pin the properties the import
// promises:
//
//   * canonical, field-complete serialization that is order-independent between
//     the source object and the row read back;
//   * one transaction covering notes, tasks, snippets (with ordered tags) and
//     the archive, with a marker written only after a full-content verification;
//   * an idempotent retry, a conflict refused rather than overwritten, and a
//     rollback that sets no marker when a later step fails;
//   * a marker that is separate from `PRAGMA user_version`;
//   * typed handler outcomes that leak no SQL, message or path.
//
// Dependency-free: Node's built-in test runner, type stripping and `node:sqlite`.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'

import { canonicalArchiveItem, canonicalNote, canonicalSnippet, canonicalTask } from '../electron/db/canonical.ts'
import { initializeDatabase, readDatabaseVersion, type AppDatabase } from '../electron/db/database.ts'
import {
  importWorkspace,
  MIGRATION_MARKER_KEY,
  readMigrationStatus,
} from '../electron/db/migration.ts'
import { createSqliteArchiveRepository } from '../electron/db/repositories/archiveRepository.ts'
import { createSqliteNoteRepository } from '../electron/db/repositories/noteRepository.ts'
import { createSqliteSnippetRepository } from '../electron/db/repositories/snippetRepository.ts'
import { createSqliteTaskRepository } from '../electron/db/repositories/taskRepository.ts'
import { createMigrationHandlers } from '../electron/ipc/migrationHandlers.ts'
import type { MigrationSource } from '@/data/ipc/contract'
import type { ArchivedItem } from '@/types/archive'
import type { Note } from '@/types/note'
import type { Snippet } from '@/types/snippet'
import type { Task } from '@/types/task'

let root: string

before(() => {
  root = mkdtempSync(join(tmpdir(), 'x31desk-migration-'))
})

after(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Opens a throwaway database and closes it once `run` settles. */
async function withDatabase(name: string, run: (database: AppDatabase) => Promise<void>) {
  const database = initializeDatabase(join(root, name))

  try {
    await run(database)
  } finally {
    database.close()
  }
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function makeNote(overrides: Partial<Note> = {}): Note {
  return { id: 'n1', title: 'Note', content: 'Body', createdAt: 1000, updatedAt: 2000, ...overrides }
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Task',
    description: 'Details',
    dueDate: '2026-01-02',
    priority: 'high',
    completed: true,
    createdAt: 1000,
    updatedAt: 2000,
    completedAt: 2500,
    ...overrides,
  }
}

function makeSnippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: 's1',
    title: 'Snippet',
    code: 'const x = 1',
    language: 'typescript',
    tags: ['beta', 'alpha'],
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  }
}

function makeArchivedNote(overrides: Partial<ArchivedItem> = {}): ArchivedItem {
  return { type: 'note', archivedAt: 5000, note: makeNote(), ...overrides }
}

const EMPTY: MigrationSource = { notes: [], tasks: [], snippets: [], archive: [] }

/** The marker row's raw value, or `null` when absent. */
function markerValue(database: AppDatabase): string | null {
  const row = database.connection.prepare('SELECT value FROM meta WHERE key = ?').get(MIGRATION_MARKER_KEY) as
    | Record<string, unknown>
    | undefined

  return row === undefined ? null : String(row['value'])
}

// ---------------------------------------------------------------------------
// canonical serialization
// ---------------------------------------------------------------------------

test('a record canonicalises the same however its object was built', () => {
  const a = makeNote({ id: 'n1', title: 'T', content: 'C' })
  const b = { updatedAt: 2000, content: 'C', id: 'n1', createdAt: 1000, title: 'T' } as Note

  assert.equal(canonicalNote(a), canonicalNote(b))
})

test('every persisted field takes part in a record’s identity', () => {
  const note = makeNote()
  assert.notEqual(canonicalNote(note), canonicalNote({ ...note, title: 'different' }))
  assert.notEqual(canonicalNote(note), canonicalNote({ ...note, updatedAt: 9999 }))

  const task = makeTask()
  assert.notEqual(canonicalTask(task), canonicalTask({ ...task, completed: false }))
  assert.notEqual(canonicalTask(task), canonicalTask({ ...task, dueDate: null }))
  assert.notEqual(canonicalTask(task), canonicalTask({ ...task, completedAt: null }))

  const snippet = makeSnippet()
  assert.notEqual(canonicalSnippet(snippet), canonicalSnippet({ ...snippet, language: 'plaintext' }))
})

test('snippet tag order is part of the canonical form', () => {
  const snippet = makeSnippet({ tags: ['a', 'b'] })

  assert.notEqual(canonicalSnippet(snippet), canonicalSnippet({ ...snippet, tags: ['b', 'a'] }))
})

test('an archived item’s payload and timestamp are part of its canonical form', () => {
  const entry = makeArchivedNote()

  assert.notEqual(canonicalArchiveItem(entry), canonicalArchiveItem({ ...entry, archivedAt: 6000 }))
  assert.notEqual(
    canonicalArchiveItem(entry),
    canonicalArchiveItem({
      type: 'note',
      archivedAt: entry.archivedAt,
      note: makeNote({ title: 'other' }),
    }),
  )
})

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

test('a fresh import writes every collection and records the marker', async () => {
  await withDatabase('fresh.db', async (database) => {
    const source: MigrationSource = {
      notes: [makeNote()],
      tasks: [makeTask()],
      snippets: [makeSnippet()],
      archive: [makeArchivedNote()],
    }

    const before = readDatabaseVersion(database.connection)
    const outcome = importWorkspace(database.connection, source)

    assert.deepEqual(outcome, {
      outcome: 'completed',
      counts: { notes: 1, tasks: 1, snippets: 1, archive: 1 },
      alreadyCompleted: false,
    })

    assert.equal(readDatabaseVersion(database.connection), before)
    assert.notEqual(markerValue(database), null)

    const status = readMigrationStatus(database.connection)
    assert.equal(status.status, 'completed')
    if (status.status === 'completed') {
      assert.equal(typeof status.completedAt, 'number')
      assert.deepEqual(status.counts, { notes: 1, tasks: 1, snippets: 1, archive: 1 })
    }
  })
})

test('the imported rows read back exactly, tags in order', async () => {
  await withDatabase('roundtrip.db', async (database) => {
    const note = makeNote()
    const task = makeTask()
    const snippet = makeSnippet({ tags: ['zed', 'alpha', 'mid'] })
    const entry = makeArchivedNote()

    importWorkspace(database.connection, { notes: [note], tasks: [task], snippets: [snippet], archive: [entry] })

    assert.deepEqual(await createSqliteNoteRepository(database.connection).list(), [note])
    assert.deepEqual(await createSqliteTaskRepository(database.connection).list(), [task])
    assert.deepEqual(await createSqliteSnippetRepository(database.connection).list(), [snippet])
    assert.deepEqual(await createSqliteArchiveRepository(database.connection).list(), [entry])
  })
})

test('an empty or missing-collection source completes with zero counts', async () => {
  await withDatabase('empty.db', async (database) => {
    assert.deepEqual(importWorkspace(database.connection, EMPTY), {
      outcome: 'completed',
      counts: { notes: 0, tasks: 0, snippets: 0, archive: 0 },
      alreadyCompleted: false,
    })
  })
})

test('a retry after success writes nothing and reports it', async () => {
  await withDatabase('retry.db', async (database) => {
    const source: MigrationSource = { ...EMPTY, notes: [makeNote()] }

    importWorkspace(database.connection, source)
    const again = importWorkspace(database.connection, source)

    assert.equal(again.outcome, 'completed')
    if (again.outcome === 'completed') {
      assert.equal(again.alreadyCompleted, true)
      assert.deepEqual(again.counts, { notes: 1, tasks: 0, snippets: 0, archive: 0 })
    }

    assert.equal((await createSqliteNoteRepository(database.connection).list()).length, 1)
  })
})

test('a source that names one id twice with different content is refused as a conflict', async () => {
  await withDatabase('dup-source.db', async (database) => {
    const outcome = importWorkspace(database.connection, {
      ...EMPTY,
      notes: [makeNote({ title: 'first' }), makeNote({ title: 'second' })],
    })

    assert.deepEqual(outcome, { outcome: 'conflict', conflicts: [{ collection: 'notes', id: 'n1' }] })
    assert.equal(markerValue(database), null)
    assert.deepEqual(await createSqliteNoteRepository(database.connection).list(), [])
  })
})

test('a source that names one id twice with identical content collapses to one record', async () => {
  await withDatabase('dup-identical.db', async (database) => {
    const note = makeNote()

    const outcome = importWorkspace(database.connection, { ...EMPTY, notes: [note, { ...note }] })

    assert.equal(outcome.outcome, 'completed')
    if (outcome.outcome === 'completed') {
      assert.equal(outcome.counts.notes, 1)
    }
  })
})

test('a destination record that differs is a conflict and is never overwritten', async () => {
  await withDatabase('conflict.db', async (database) => {
    const existing = makeNote({ title: 'keep me' })
    await createSqliteNoteRepository(database.connection).insert(existing)

    const outcome = importWorkspace(database.connection, { ...EMPTY, notes: [makeNote({ title: 'replace me' })] })

    assert.deepEqual(outcome, { outcome: 'conflict', conflicts: [{ collection: 'notes', id: 'n1' }] })
    assert.equal(markerValue(database), null)
    assert.deepEqual(await createSqliteNoteRepository(database.connection).list(), [existing])
  })
})

test('a destination record that matches exactly is accepted, not rewritten', async () => {
  await withDatabase('exact.db', async (database) => {
    const note = makeNote()
    await createSqliteNoteRepository(database.connection).insert(note)

    const outcome = importWorkspace(database.connection, { ...EMPTY, notes: [note], tasks: [makeTask()] })

    assert.equal(outcome.outcome, 'completed')
    assert.equal((await createSqliteNoteRepository(database.connection).list()).length, 1)
    assert.equal((await createSqliteTaskRepository(database.connection).list()).length, 1)
  })
})

test('the archive is keyed by kind and id, so a note and a task may share an id', async () => {
  await withDatabase('archive-keys.db', async (database) => {
    const note: ArchivedItem = { type: 'note', archivedAt: 5000, note: makeNote({ id: 'shared' }) }
    const task: ArchivedItem = { type: 'task', archivedAt: 6000, task: makeTask({ id: 'shared' }) }

    const outcome = importWorkspace(database.connection, { ...EMPTY, archive: [note, task] })

    assert.equal(outcome.outcome, 'completed')
    if (outcome.outcome === 'completed') {
      assert.equal(outcome.counts.archive, 2)
    }
  })
})

test('a later write failure rolls the whole import back and sets no marker', async () => {
  await withDatabase('rollback.db', async (database) => {
    // A circular extra property makes the archive row's `JSON.stringify` throw
    // during the write, after the note has already been inserted — but the
    // canonical form only reads known fields, so the source still maps cleanly.
    const circular: ArchivedItem & { self?: unknown } = makeArchivedNote()
    circular.self = circular

    assert.throws(() =>
      importWorkspace(database.connection, {
        ...EMPTY,
        notes: [makeNote()],
        archive: [circular],
      }),
    )

    assert.equal(markerValue(database), null)
    assert.deepEqual(await createSqliteNoteRepository(database.connection).list(), [])
  })
})

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

test('an unavailable database reports unavailable for both channels', () => {
  const handlers = createMigrationHandlers(() => null)

  assert.deepEqual(handlers.status(), { status: 'unavailable' })
  assert.deepEqual(handlers.import([{ source: EMPTY }]), { outcome: 'unavailable' })
})

test('a malformed import payload is an invalid source, never a throw', () => {
  const handlers = createMigrationHandlers(() => null)

  assert.deepEqual(handlers.import([]), { outcome: 'invalid-source', collections: [] })
  assert.deepEqual(handlers.import([{ source: { notes: 'nope' } }]), {
    outcome: 'invalid-source',
    collections: [],
  })
  assert.deepEqual(handlers.import([{}]), { outcome: 'invalid-source', collections: [] })
})

test('the import handler performs the import and reports counts', async () => {
  await withDatabase('handler.db', async (database) => {
    const handlers = createMigrationHandlers(() => database.connection)

    const outcome = handlers.import([{ source: { ...EMPTY, notes: [makeNote()] } }])

    assert.deepEqual(outcome, {
      outcome: 'completed',
      counts: { notes: 1, tasks: 0, snippets: 0, archive: 0 },
      alreadyCompleted: false,
    })

    const status = handlers.status()
    assert.equal(status.status, 'completed')
    if (status.status === 'completed') {
      assert.equal(typeof status.completedAt, 'number')
      assert.deepEqual(status.counts, { notes: 1, tasks: 0, snippets: 0, archive: 0 })
    }
  })
})

test('a database exception becomes a classified outcome that leaks nothing', () => {
  const boom = Object.assign(new Error('disk exploded at C:\\secret\\x31desk.db'), {
    errcode: 13,
  })
  const failing = {
    prepare() {
      throw boom
    },
  } as unknown as DatabaseSync
  const handlers = createMigrationHandlers(() => failing)

  const outcome = handlers.import([{ source: EMPTY }])

  assert.deepEqual(outcome, { outcome: 'failed', kind: 'quota' })
  assert.equal(JSON.stringify(outcome).includes('secret'), false)
  assert.equal(JSON.stringify(outcome).includes('exploded'), false)
})
