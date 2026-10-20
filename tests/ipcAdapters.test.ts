// Focused tests for the renderer-side IPC repository adapters:
//   * each adapter implements its repository interface by calling exactly the
//     matching preload method with the shape the contract expects;
//   * a successful envelope is unwrapped to its value;
//   * a failure envelope is turned into a `StorageError` of the same kind, so the
//     existing storage-error handling is unchanged whether the store is
//     `localStorage` or the main process.
//
// The adapters are given a hand-built bridge, so these run under plain Node with
// no Electron and no database.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createIpcArchiveRepository } from '@/data/ipc/archiveRepository'
import { createIpcNoteRepository } from '@/data/ipc/noteRepository'
import { createIpcSnippetRepository } from '@/data/ipc/snippetRepository'
import { createIpcTaskRepository } from '@/data/ipc/taskRepository'
import { StorageError, type StorageErrorKind } from '@/data/storageError'

const NOTE = { id: 'n1', title: 'T', content: 'C', createdAt: 1, updatedAt: 1 }
const TASK = {
  id: 't1',
  title: 'T',
  description: 'D',
  dueDate: null,
  priority: 'medium' as const,
  completed: false,
  createdAt: 1,
  updatedAt: 1,
  completedAt: null,
}
const SNIPPET = {
  id: 's1',
  title: 'T',
  code: 'c',
  language: 'plaintext' as const,
  tags: [],
  createdAt: 1,
  updatedAt: 1,
}
const ENTRY = { type: 'note' as const, archivedAt: 1, note: NOTE }

const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value })
const fail = (kind: StorageErrorKind) => Promise.resolve({ ok: false as const, kind })

// ---------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------

test('the note adapter forwards to the note channels and unwraps the value', async () => {
  const seen: unknown[] = []
  const notes = {
    list: () => ok([NOTE]),
    create: () => ok(NOTE),
    update: (request: unknown) => {
      seen.push(['update', request])
      return ok(NOTE)
    },
    insert: (request: unknown) => {
      seen.push(['insert', request])
      return ok(NOTE)
    },
    remove: (request: unknown) => {
      seen.push(['remove', request])
      return ok(undefined)
    },
    clear: () => ok(undefined),
  }

  const repository = createIpcNoteRepository(notes)

  assert.deepEqual(await repository.list(), [NOTE])
  assert.deepEqual(await repository.create(), NOTE)
  assert.deepEqual(await repository.update('n1', { title: 'A', content: 'B' }), NOTE)
  assert.deepEqual(await repository.insert(NOTE), NOTE)
  await repository.remove('n1')
  await repository.clear()

  assert.deepEqual(seen, [
    ['update', { id: 'n1', draft: { title: 'A', content: 'B' } }],
    ['insert', { note: NOTE }],
    ['remove', { id: 'n1' }],
  ])
})

test('the note adapter turns a failure envelope into a tagged StorageError', async () => {
  const repository = createIpcNoteRepository({
    list: () => fail('unavailable'),
    create: () => fail('quota'),
    update: () => fail('quota'),
    insert: () => fail('quota'),
    remove: () => fail('quota'),
    clear: () => fail('unavailable'),
  })

  await assert.rejects(
    () => repository.list(),
    (error) => error instanceof StorageError && error.kind === 'unavailable',
  )
  await assert.rejects(
    () => repository.create(),
    (error) => error instanceof StorageError && error.kind === 'quota',
  )
  await assert.rejects(() => repository.update('n1', { title: '', content: '' }), (error) => {
    return error instanceof StorageError && error.kind === 'quota'
  })
  await assert.rejects(() => repository.clear(), (error) => {
    return error instanceof StorageError && error.kind === 'unavailable'
  })
})

// ---------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------

test('the task adapter forwards create and setCompleted in the contract shape', async () => {
  const seen: unknown[] = []
  const tasks = {
    list: () => ok([TASK]),
    create: (request: unknown) => {
      seen.push(['create', request])
      return ok(TASK)
    },
    update: (request: unknown) => {
      seen.push(['update', request])
      return ok(TASK)
    },
    setCompleted: (request: unknown) => {
      seen.push(['setCompleted', request])
      return ok(TASK)
    },
    insert: (request: unknown) => {
      seen.push(['insert', request])
      return ok(TASK)
    },
    remove: () => ok(undefined),
    clear: () => ok(undefined),
  }

  const repository = createIpcTaskRepository(tasks)
  const draft = { title: 'T', description: 'D', dueDate: null, priority: 'medium' as const }

  assert.deepEqual(await repository.list(), [TASK])
  assert.deepEqual(await repository.create(draft), TASK)
  await repository.setCompleted('t1', true)

  assert.deepEqual(seen, [
    ['create', { draft }],
    ['setCompleted', { id: 't1', completed: true }],
  ])
})

test('the task adapter throws a tagged StorageError on failure', async () => {
  const tasks = {
    list: () => fail('unavailable'),
    create: () => fail('unknown'),
    update: () => fail('unknown'),
    setCompleted: () => fail('unknown'),
    insert: () => fail('unknown'),
    remove: () => fail('unknown'),
    clear: () => fail('unknown'),
  }

  await assert.rejects(
    () => createIpcTaskRepository(tasks).list(),
    (error) => error instanceof StorageError && error.kind === 'unavailable',
  )
})

// ---------------------------------------------------------------------------
// snippets
// ---------------------------------------------------------------------------

test('the snippet adapter forwards the raw tag text as a draft', async () => {
  let request: unknown
  const snippets = {
    list: () => ok([SNIPPET]),
    create: (value: unknown) => {
      request = value
      return ok(SNIPPET)
    },
    update: () => ok(SNIPPET),
    insert: () => ok(SNIPPET),
    remove: () => ok(undefined),
    clear: () => ok(undefined),
  }

  const repository = createIpcSnippetRepository(snippets)
  const draft = { title: 'T', code: 'c', language: 'typescript' as const, tags: 'a, b' }

  assert.deepEqual(await repository.create(draft), SNIPPET)
  assert.deepEqual(request, { draft })
})

test('the snippet adapter throws a tagged StorageError on failure', async () => {
  const snippets = {
    list: () => fail('quota'),
    create: () => fail('quota'),
    update: () => fail('quota'),
    insert: () => fail('quota'),
    remove: () => fail('quota'),
    clear: () => fail('quota'),
  }

  await assert.rejects(
    () => createIpcSnippetRepository(snippets).list(),
    (error) => error instanceof StorageError && error.kind === 'quota',
  )
})

// ---------------------------------------------------------------------------
// archive
// ---------------------------------------------------------------------------

test('the archive adapter forwards add and remove in the contract shape', async () => {
  let addRequest: unknown
  let removeRequest: unknown
  const archive = {
    list: () => ok([ENTRY]),
    add: (request: unknown) => {
      addRequest = request
      return ok(ENTRY)
    },
    remove: (request: unknown) => {
      removeRequest = request
      return ok(undefined)
    },
    clear: () => ok(undefined),
  }

  const repository = createIpcArchiveRepository(archive)

  assert.deepEqual(await repository.list(), [ENTRY])
  assert.deepEqual(await repository.add(ENTRY), ENTRY)
  await repository.remove('note', 'n1')

  assert.deepEqual(addRequest, { entry: ENTRY })
  assert.deepEqual(removeRequest, { type: 'note', id: 'n1' })
})

test('the archive adapter throws a tagged StorageError on failure', async () => {
  const archive = {
    list: () => fail('unavailable'),
    add: () => fail('unavailable'),
    remove: () => fail('unavailable'),
    clear: () => fail('unavailable'),
  }

  await assert.rejects(
    () => createIpcArchiveRepository(archive).add(ENTRY),
    (error) => error instanceof StorageError && error.kind === 'unavailable',
  )
})
