// Focused tests for the SQLite-backed repository adapters:
//   * `createSqliteNoteRepository`, `createSqliteTaskRepository`,
//     `createSqliteSnippetRepository` and `createSqliteArchiveRepository` satisfy
//     the same interfaces their `localStorage` counterparts do;
//   * the behaviours the application depends on — insert-as-upsert, tag
//     ordering, archive keying, `null` for a missing record — hold against a real
//     database.
//
// These run under plain Node, not Electron: a repository takes its `DatabaseSync`
// as an argument, so the code the main process runs is exercised directly against
// a throwaway database in the OS temp directory. No test touches the user's
// profile.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { createArchiveQuarantine } from '../electron/db/archiveQuarantine.ts'
import { initializeDatabase, type AppDatabase } from '../electron/db/database.ts'
import { createSqliteArchiveRepository } from '../electron/db/repositories/archiveRepository.ts'
import { createSqliteNoteRepository } from '../electron/db/repositories/noteRepository.ts'
import { createSqliteSnippetRepository } from '../electron/db/repositories/snippetRepository.ts'
import { createSqliteTaskRepository } from '../electron/db/repositories/taskRepository.ts'
import type { ArchivedItem } from '@/types/archive'
import type { Note, NoteDraft } from '@/types/note'
import type { Snippet, SnippetDraft } from '@/types/snippet'
import type { Task, TaskDraft } from '@/types/task'

let root: string

before(() => {
  root = mkdtempSync(join(tmpdir(), 'x31desk-sqlite-repos-'))
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
  return { id: 'n1', title: '', content: '', createdAt: 1000, updatedAt: 1000, ...overrides }
}

const NOTE_DRAFT: NoteDraft = { title: 'Title', content: 'Content' }

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Title',
    description: 'Description',
    dueDate: null,
    priority: 'medium',
    completed: false,
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: null,
    ...overrides,
  }
}

function makeTaskDraft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return { title: 'Title', description: 'Description', dueDate: null, priority: 'medium', ...overrides }
}

function makeSnippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: 's1',
    title: 'Title',
    code: 'code',
    language: 'plaintext',
    tags: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function makeSnippetDraft(overrides: Partial<SnippetDraft> = {}): SnippetDraft {
  return { title: 'Title', code: 'code', language: 'plaintext', tags: '', ...overrides }
}

// ---------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------

test('notes: a fresh store is empty and create mints an empty note', async () => {
  await withDatabase('notes-create', async (database) => {
    const notes = createSqliteNoteRepository(database.connection)

    assert.deepEqual(await notes.list(), [])

    const created = await notes.create()

    assert.ok(created.id.length > 0)
    assert.equal(created.title, '')
    assert.equal(created.content, '')
    assert.ok(Number.isFinite(created.createdAt))
    assert.deepEqual(await notes.list(), [created])
  })
})

test('notes: update edits a note and returns null once it is gone', async () => {
  await withDatabase('notes-update', async (database) => {
    const notes = createSqliteNoteRepository(database.connection)
    const created = await notes.create()

    const updated = await notes.update(created.id, NOTE_DRAFT)

    assert.equal(updated?.id, created.id)
    assert.equal(updated?.title, 'Title')
    assert.equal(updated?.content, 'Content')
    assert.equal(updated?.createdAt, created.createdAt)
    assert.ok((updated?.updatedAt ?? 0) >= created.createdAt)

    await notes.remove(created.id)

    assert.equal(await notes.update(created.id, NOTE_DRAFT), null)
  })
})

test('notes: insert writes a record verbatim and upserts by id', async () => {
  await withDatabase('notes-insert', async (database) => {
    const notes = createSqliteNoteRepository(database.connection)
    const original = makeNote({ id: 'keep', title: 'Original', createdAt: 5, updatedAt: 7 })

    assert.equal(await notes.insert(original), original)
    assert.deepEqual(await notes.list(), [original])

    await notes.insert(makeNote({ id: 'n1', content: 'B' }))
    await notes.insert(makeNote({ id: 'n1', content: 'C' }))

    const stored = await notes.list()

    assert.equal(stored.length, 2)
    assert.equal(stored.find((note) => note.id === 'n1')?.content, 'C')
  })
})

test('notes: a fresh list is empty and removal clears a note', async () => {
  await withDatabase('notes-remove-clear', async (database) => {
    const notes = createSqliteNoteRepository(database.connection)
    const created = await notes.create()

    await notes.remove('does-not-exist')
    assert.equal((await notes.list()).length, 1)

    await notes.remove(created.id)
    assert.deepEqual(await notes.list(), [])

    await notes.insert(created)
    await notes.clear()
    assert.deepEqual(await notes.list(), [])
  })
})

test('notes: list preserves insertion order', async () => {
  await withDatabase('notes-order', async (database) => {
    const notes = createSqliteNoteRepository(database.connection)

    for (const id of ['a', 'b', 'c']) {
      await notes.insert(makeNote({ id }))
    }

    assert.deepEqual(
      (await notes.list()).map((note) => note.id),
      ['a', 'b', 'c'],
    )
  })
})

// ---------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------

test('tasks: create applies the draft and starts open', async () => {
  await withDatabase('tasks-create', async (database) => {
    const tasks = createSqliteTaskRepository(database.connection)

    const created = await tasks.create(makeTaskDraft({ title: 'Ship', dueDate: '2026-10-14' }))

    assert.equal(created.title, 'Ship')
    assert.equal(created.dueDate, '2026-10-14')
    assert.equal(created.priority, 'medium')
    assert.equal(created.completed, false)
    assert.equal(created.completedAt, null)
  })
})

test('tasks: update edits the record but leaves completion alone', async () => {
  await withDatabase('tasks-update', async (database) => {
    const tasks = createSqliteTaskRepository(database.connection)
    const created = await tasks.create(makeTaskDraft())
    const completed = await tasks.setCompleted(created.id, true)

    const updated = await tasks.update(created.id, makeTaskDraft({ title: 'Edited', priority: 'high' }))

    assert.equal(updated?.title, 'Edited')
    assert.equal(updated?.priority, 'high')
    assert.equal(updated?.completed, true)
    assert.equal(updated?.completedAt, completed?.completedAt)

    assert.equal(await tasks.update('missing', makeTaskDraft()), null)
  })
})

test('tasks: setCompleted stamps and clears completedAt', async () => {
  await withDatabase('tasks-complete', async (database) => {
    const tasks = createSqliteTaskRepository(database.connection)
    const created = await tasks.create(makeTaskDraft())

    const done = await tasks.setCompleted(created.id, true)

    assert.equal(done?.completed, true)
    assert.equal(typeof done?.completedAt, 'number')

    const reopened = await tasks.setCompleted(created.id, false)

    assert.equal(reopened?.completed, false)
    assert.equal(reopened?.completedAt, null)

    assert.equal(await tasks.setCompleted('missing', true), null)
  })
})

test('tasks: insert upserts the whole record, preserving state', async () => {
  await withDatabase('tasks-insert', async (database) => {
    const tasks = createSqliteTaskRepository(database.connection)
    const record = makeTask({ id: 't9', completed: true, completedAt: 2000, priority: 'high' })

    assert.deepEqual(await tasks.insert(record), record)
    assert.deepEqual(await tasks.list(), [record])

    await tasks.insert(makeTask({ id: 't9', title: 'Replaced', completed: false }))

    const list = await tasks.list()

    assert.equal(list.length, 1)
    assert.equal(list[0]?.title, 'Replaced')
    assert.equal(list[0]?.completed, false)
    assert.equal(list[0]?.completedAt, null)
  })
})

test('tasks: remove and clear empty the store', async () => {
  await withDatabase('tasks-remove-clear', async (database) => {
    const tasks = createSqliteTaskRepository(database.connection)
    const created = await tasks.create(makeTaskDraft())

    await tasks.remove(created.id)
    assert.deepEqual(await tasks.list(), [])

    await tasks.insert(created)
    await tasks.clear()
    assert.deepEqual(await tasks.list(), [])
  })
})

// ---------------------------------------------------------------------------
// snippets
// ---------------------------------------------------------------------------

test('snippets: create parses and de-duplicates the tag text', async () => {
  await withDatabase('snippets-create', async (database) => {
    const snippets = createSqliteSnippetRepository(database.connection)

    const created = await snippets.create(makeSnippetDraft({ tags: 'b, a, A, c' }))

    assert.deepEqual(created.tags, ['b', 'a', 'c'])
    assert.deepEqual((await snippets.list())[0]?.tags, ['b', 'a', 'c'])
  })
})

test('snippets: update replaces the tag set', async () => {
  await withDatabase('snippets-update', async (database) => {
    const snippets = createSqliteSnippetRepository(database.connection)
    const created = await snippets.create(makeSnippetDraft({ tags: 'old, stale' }))

    const updated = await snippets.update(created.id, makeSnippetDraft({ tags: 'new' }))

    assert.deepEqual(updated?.tags, ['new'])
    assert.deepEqual((await snippets.list())[0]?.tags, ['new'])

    assert.equal(await snippets.update('missing', makeSnippetDraft()), null)
  })
})

test('snippets: insert upserts with the record tag order and remove drops tags', async () => {
  await withDatabase('snippets-insert-remove', async (database) => {
    const snippets = createSqliteSnippetRepository(database.connection)
    const record = makeSnippet({ id: 's9', tags: ['z', 'y', 'x'] })

    assert.deepEqual(await snippets.insert(record), record)
    assert.deepEqual((await snippets.list())[0]?.tags, ['z', 'y', 'x'])

    await snippets.insert(makeSnippet({ id: 's9', title: 'Replaced', tags: [] }))

    const list = await snippets.list()

    assert.equal(list.length, 1)
    assert.equal(list[0]?.title, 'Replaced')
    assert.deepEqual(list[0]?.tags, [])

    await snippets.remove('s9')
    assert.deepEqual(await snippets.list(), [])
  })
})

test('snippets: clear empties snippets and their tags', async () => {
  await withDatabase('snippets-clear', async (database) => {
    const snippets = createSqliteSnippetRepository(database.connection)

    await snippets.create(makeSnippetDraft({ tags: 'a, b' }))
    await snippets.clear()

    assert.deepEqual(await snippets.list(), [

    ])
    assert.equal(
      database.connection.prepare('SELECT COUNT(*) AS count FROM snippet_tags').get()?.count,
      0,
    )
  })
})

// ---------------------------------------------------------------------------
// archive
// ---------------------------------------------------------------------------

test('archive: add stores an entry verbatim and list returns it', async () => {
  await withDatabase('archive-add', async (database) => {
    const archive = createSqliteArchiveRepository(database.connection)
    const entry: ArchivedItem = { type: 'task', archivedAt: 5000, task: makeTask({ id: 't3' }) }

    assert.deepEqual(await archive.add(entry), entry)
    assert.deepEqual(await archive.list(), [entry])
  })
})

test('archive: add upserts by kind and id, so a record appears once', async () => {
  await withDatabase('archive-upsert', async (database) => {
    const archive = createSqliteArchiveRepository(database.connection)

    await archive.add({ type: 'note', archivedAt: 1, note: makeNote({ id: 'n1', title: 'First' }) })
    await archive.add({ type: 'note', archivedAt: 2, note: makeNote({ id: 'n1', title: 'Second' }) })

    const list = await archive.list()

    assert.equal(list.length, 1)
    assert.equal(list[0]?.type === 'note' ? list[0].note.title : null, 'Second')
  })
})

test('archive: a note and a task may share an id without colliding', async () => {
  await withDatabase('archive-shared-id', async (database) => {
    const archive = createSqliteArchiveRepository(database.connection)

    const noteEntry: ArchivedItem = { type: 'note', archivedAt: 1, note: makeNote({ id: 'same' }) }
    const taskEntry: ArchivedItem = { type: 'task', archivedAt: 2, task: makeTask({ id: 'same' }) }

    await archive.add(noteEntry)
    await archive.add(taskEntry)

    assert.equal((await archive.list()).length, 2)
  })
})

test('archive: list presents newest first and preserves an unreadable row', async () => {
  await withDatabase('archive-list', async (database) => {
    const archive = createSqliteArchiveRepository(database.connection)

    await archive.add({ type: 'note', archivedAt: 100, note: makeNote({ id: 'old' }) })
    await archive.add({ type: 'note', archivedAt: 300, note: makeNote({ id: 'new' }) })
    await archive.add({ type: 'note', archivedAt: 200, note: makeNote({ id: 'middle' }) })

    // A row this adapter did not write is preserved in the corruption vault and
    // left out of the list — skipped, not thrown, and not lost.
    database.connection
      .prepare('INSERT INTO archive (type, record_id, archived_at, data) VALUES (?, ?, ?, ?)')
      .run('note', 'broken', 999, 'not json')

    assert.deepEqual(
      (await archive.list()).map((item) => (item.type === 'note' ? item.note.id : '')),
      ['new', 'middle', 'old'],
    )

    const preserved = createArchiveQuarantine(database.connection).list()

    assert.equal(preserved.length, 1)
    assert.equal(preserved[0]?.type, 'note')
    assert.equal(preserved[0]?.recordId, 'broken')
    assert.equal(preserved[0]?.archivedAt, 999)
    assert.equal(preserved[0]?.data, 'not json')
  })
})

test('archive: remove addresses one entry and clear empties the archive', async () => {
  await withDatabase('archive-remove-clear', async (database) => {
    const archive = createSqliteArchiveRepository(database.connection)

    await archive.add({ type: 'note', archivedAt: 1, note: makeNote({ id: 'n1' }) })
    await archive.add({ type: 'task', archivedAt: 1, task: makeTask({ id: 't1' }) })

    await archive.remove('note', 'n1')
    await archive.remove('note', 'missing')

    const list = await archive.list()

    assert.equal(list.length, 1)
    assert.equal(list[0]?.type, 'task')

    await archive.clear()
    assert.deepEqual(await archive.list(), [])
  })
})
