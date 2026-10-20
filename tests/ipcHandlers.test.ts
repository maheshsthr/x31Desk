// Focused tests for the main-process repository IPC handlers:
//   * every repository channel is handled, and only those;
//   * a well-formed call reaches the SQLite store and returns an `ok` envelope;
//   * a malformed call is rejected with the failure envelope rather than thrown;
//   * an unavailable database is reported, never crashed on;
//   * a database exception becomes a classified envelope that leaks no SQL,
//     message or filesystem path across IPC;
//   * a multi-step operation rolls back in full when a later step fails;
//   * a SQLite result code maps to the renderer's storage-error vocabulary;
//   * the preload reaches the contract only through its named methods.
//
// These run under plain Node: `createRepositoryHandlers` takes its database
// through a provider and never imports Electron at runtime, so the handler logic
// is exercised against a throwaway database directly. The preload is not
// imported — it needs `electron` — but its source is read to confirm it exposes
// no generic invoker.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'

import { IPC_CHANNELS, SHELL_CHANNELS } from '@/data/ipc/contract'

import { initializeDatabase, type AppDatabase } from '../electron/db/database.ts'
import { classifyDatabaseError } from '../electron/db/errorKind.ts'
import {
  createRepositoryHandlers,
  registerRepositoryHandlers,
  type RepositoryHandlers,
} from '../electron/ipc/repositoryHandlers.ts'

let root: string

before(() => {
  root = mkdtempSync(join(tmpdir(), 'x31desk-ipc-handlers-'))
})

after(() => {
  rmSync(root, { recursive: true, force: true })
})

function openDatabase(name: string): AppDatabase {
  return initializeDatabase(join(root, name))
}

/** Builds handlers bound to a database, or to no database at all. */
function handlersFor(database: AppDatabase | null): RepositoryHandlers {
  return createRepositoryHandlers(() => (database === null ? null : database.connection))
}

async function withHandlers(
  name: string,
  run: (handlers: RepositoryHandlers, database: AppDatabase) => Promise<void>,
) {
  const database = openDatabase(name)

  try {
    await run(handlersFor(database), database)
  } finally {
    database.close()
  }
}

const UNAVAILABLE = { ok: false, kind: 'unavailable' }
const INVALID = { ok: false, kind: 'unknown' }

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

test('exactly the repository channels are registered', () => {
  const registered = new Map<string, unknown>()
  const ipcMain = {
    handle: (channel: string, listener: unknown) => {
      registered.set(channel, listener)
    },
  }

  registerRepositoryHandlers(ipcMain, () => null)

  const shellChannels = new Set<string>(SHELL_CHANNELS)
  const expected = Object.values(IPC_CHANNELS).filter((channel) => !shellChannels.has(channel))

  assert.deepEqual([...registered.keys()].sort(), [...expected].sort())
})

test('a registered listener forwards its arguments to the handler', async () => {
  const registered = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
  const ipcMain = {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      registered.set(channel, listener)
    },
  }

  registerRepositoryHandlers(ipcMain, () => null)

  const listener = registered.get(IPC_CHANNELS.notesList)
  assert.ok(listener)
  // No database is open, so this is the unavailable envelope — the point is that
  // it reached the handler with the arguments forwarded.
  assert.deepEqual(await listener(null), UNAVAILABLE)
})

// ---------------------------------------------------------------------------
// unavailable database
// ---------------------------------------------------------------------------

test('an unavailable database is reported, not thrown, for every shape of channel', async () => {
  const handlers = handlersFor(null)

  assert.deepEqual(await handlers[IPC_CHANNELS.notesList]([]), UNAVAILABLE)
  assert.deepEqual(await handlers[IPC_CHANNELS.notesCreate]([]), UNAVAILABLE)
  assert.deepEqual(
    await handlers[IPC_CHANNELS.notesUpdate]([{ id: 'x', draft: { title: '', content: '' } }]),
    UNAVAILABLE,
  )
})

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

test('a channel that takes no arguments rejects one passed to it', async () => {
  await withHandlers('validate-no-args', async (handlers) => {
    assert.deepEqual(await handlers[IPC_CHANNELS.notesList]([{}]), INVALID)
    assert.deepEqual(await handlers[IPC_CHANNELS.notesClear](['extra']), INVALID)
  })
})

test('a channel that takes a payload rejects a missing or extra argument', async () => {
  await withHandlers('validate-arg-count', async (handlers) => {
    assert.deepEqual(await handlers[IPC_CHANNELS.notesUpdate]([]), INVALID)
    assert.deepEqual(
      await handlers[IPC_CHANNELS.notesUpdate]([
        { id: 'x', draft: { title: '', content: '' } },
        'extra',
      ]),
      INVALID,
    )
  })
})

test('malformed payloads are rejected before they reach the store', async () => {
  await withHandlers('validate-payloads', async (handlers) => {
    // A missing or malformed id.
    assert.deepEqual(await handlers[IPC_CHANNELS.notesUpdate]([{ draft: { title: '', content: '' } }]), INVALID)
    assert.deepEqual(
      await handlers[IPC_CHANNELS.notesUpdate]([{ id: 42, draft: { title: '', content: '' } }]),
      INVALID,
    )
    assert.deepEqual(await handlers[IPC_CHANNELS.notesRemove]([{ id: '' }]), INVALID)

    // A malformed draft.
    assert.deepEqual(
      await handlers[IPC_CHANNELS.notesUpdate]([{ id: 'x', draft: { title: 1, content: '' } }]),
      INVALID,
    )
    assert.deepEqual(
      await handlers[IPC_CHANNELS.tasksCreate]([
        { draft: { title: 'T', description: '', dueDate: 'not-a-date', priority: 'medium' } },
      ]),
      INVALID,
    )
    assert.deepEqual(
      await handlers[IPC_CHANNELS.tasksCreate]([
        { draft: { title: 'T', description: '', dueDate: null, priority: 'urgent' } },
      ]),
      INVALID,
    )
    assert.deepEqual(
      await handlers[IPC_CHANNELS.snippetsCreate]([
        { draft: { title: 'T', code: 'c', language: 'brainfuck', tags: '' } },
      ]),
      INVALID,
    )

    // A malformed setCompleted flag.
    assert.deepEqual(await handlers[IPC_CHANNELS.tasksSetCompleted]([{ id: 'x', completed: 'yes' }]), INVALID)

    // A malformed insert record and a malformed archive entry.
    assert.deepEqual(await handlers[IPC_CHANNELS.notesInsert]([{ note: { id: 'x' } }]), INVALID)
    assert.deepEqual(await handlers[IPC_CHANNELS.archiveAdd]([{ entry: { type: 'note' } }]), INVALID)
    assert.deepEqual(await handlers[IPC_CHANNELS.archiveRemove]([{ type: 'folder', id: 'x' }]), INVALID)
  })
})

// ---------------------------------------------------------------------------
// round trips
// ---------------------------------------------------------------------------

test('notes travel through their channels', async () => {
  await withHandlers('roundtrip-notes', async (handlers) => {
    assert.deepEqual(await handlers[IPC_CHANNELS.notesList]([]), { ok: true, value: [] })

    const created = await handlers[IPC_CHANNELS.notesCreate]([])
    assert.equal(created.ok, true)

    const note = created.ok ? (created.value as { id: string }) : null
    assert.ok(note)

    const updated = await handlers[IPC_CHANNELS.notesUpdate]([
      { id: note.id, draft: { title: 'Title', content: 'Body' } },
    ])
    assert.equal(updated.ok, true)

    const updatedNote = updated.ok
      ? (updated.value as { id: string; title: string; content: string; createdAt: number; updatedAt: number })
      : null

    assert.equal(updatedNote?.id, note.id)
    assert.equal(updatedNote?.title, 'Title')
    assert.equal(updatedNote?.content, 'Body')
    assert.equal(typeof updatedNote?.createdAt, 'number')
    assert.equal(typeof updatedNote?.updatedAt, 'number')

    // Editing a note that is gone is a successful `null`, not a failure.
    assert.deepEqual(await handlers[IPC_CHANNELS.notesUpdate]([{ id: 'missing', draft: { title: '', content: '' } }]), {
      ok: true,
      value: null,
    })

    assert.deepEqual(await handlers[IPC_CHANNELS.notesRemove]([{ id: note.id }]), { ok: true, value: undefined })
    assert.deepEqual(await handlers[IPC_CHANNELS.notesList]([]), { ok: true, value: [] })
  })
})

test('tasks travel through their channels', async () => {
  await withHandlers('roundtrip-tasks', async (handlers) => {
    const created = await handlers[IPC_CHANNELS.tasksCreate]([
      { draft: { title: 'Ship', description: 'D', dueDate: '2026-10-14', priority: 'high' } },
    ])

    assert.equal(created.ok, true)
    const task = created.ok ? (created.value as { id: string; completed: boolean }) : null
    assert.ok(task)
    assert.equal(task.completed, false)

    const done = await handlers[IPC_CHANNELS.tasksSetCompleted]([{ id: task.id, completed: true }])

    assert.equal(done.ok, true)
    assert.equal(done.ok ? (done.value as { completed: boolean }).completed : null, true)
  })
})

test('snippets travel through their channels with parsed tags', async () => {
  await withHandlers('roundtrip-snippets', async (handlers) => {
    const created = await handlers[IPC_CHANNELS.snippetsCreate]([
      { draft: { title: 'T', code: 'c', language: 'typescript', tags: 'b, a, A' } },
    ])

    assert.equal(created.ok, true)
    assert.deepEqual(created.ok ? (created.value as { tags: string[] }).tags : null, ['b', 'a'])
  })
})

test('archive entries travel through their channels', async () => {
  await withHandlers('roundtrip-archive', async (handlers) => {
    const entry = {
      type: 'note',
      archivedAt: 1234,
      note: { id: 'n1', title: 'T', content: 'C', createdAt: 1, updatedAt: 2 },
    }

    assert.deepEqual(await handlers[IPC_CHANNELS.archiveAdd]([{ entry }]), { ok: true, value: entry })
    assert.deepEqual(await handlers[IPC_CHANNELS.archiveList]([]), { ok: true, value: [entry] })
    assert.deepEqual(await handlers[IPC_CHANNELS.archiveRemove]([{ type: 'note', id: 'n1' }]), {
      ok: true,
      value: undefined,
    })
    assert.deepEqual(await handlers[IPC_CHANNELS.archiveList]([]), { ok: true, value: [] })
  })
})

// ---------------------------------------------------------------------------
// error classification
// ---------------------------------------------------------------------------

test('a SQLite result code maps to the renderer vocabulary', () => {
  // Primary codes.
  assert.equal(classifyDatabaseError({ errcode: 13 }), 'quota')
  assert.equal(classifyDatabaseError({ errcode: 3 }), 'unavailable')
  assert.equal(classifyDatabaseError({ errcode: 8 }), 'unavailable')
  assert.equal(classifyDatabaseError({ errcode: 10 }), 'unavailable')
  assert.equal(classifyDatabaseError({ errcode: 14 }), 'unavailable')
  assert.equal(classifyDatabaseError({ errcode: 23 }), 'unavailable')

  // Extended codes pack the primary code into the low byte.
  assert.equal(classifyDatabaseError({ errcode: (13 | (1 << 8)) >> 0 }), 'quota')
  assert.equal(classifyDatabaseError({ errcode: 275 }), 'unknown')

  // Anything that is not a SQLite failure is left unknown.
  assert.equal(classifyDatabaseError(new Error('boom')), 'unknown')
  assert.equal(classifyDatabaseError(null), 'unknown')
  assert.equal(classifyDatabaseError(undefined), 'unknown')
  assert.equal(classifyDatabaseError({ errcode: 1 }), 'unknown')
})

// ---------------------------------------------------------------------------
// database failure paths
// ---------------------------------------------------------------------------

/** A stand-in connection whose every prepared statement fails with `error`. */
function throwingDatabase(error: unknown) {
  const statement = {
    run() {
      throw error
    },
    get() {
      throw error
    },
    all() {
      throw error
    },
  }

  return { prepare: () => statement }
}

function countOf(database: AppDatabase, table: string): number {
  const row = database.connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()

  return Number(row?.count)
}

test('a database exception becomes a classified envelope, leaking no SQL, message or path', async () => {
  const secret = Object.assign(
    new Error(
      'SQLITE_FULL: database or disk is full [SQL: INSERT INTO notes] at C:\\Users\\me\\x31desk.db',
    ),
    { errcode: 13 },
  )

  const handlers = createRepositoryHandlers(() => throwingDatabase(secret))
  const result = await handlers[IPC_CHANNELS.notesCreate]([])

  assert.deepEqual(result, { ok: false, kind: 'quota' })

  // The renderer receives only the kind: no message, no SQL, no path.
  const wire = JSON.stringify(result)
  assert.equal(wire.includes('SQLITE_FULL'), false)
  assert.equal(wire.includes('INSERT'), false)
  assert.equal(wire.includes('x31desk.db'), false)
})

test('every mapped condition reaches the renderer as its vocabulary kind', async () => {
  const cases: Array<[number, string]> = [
    [13, 'quota'],
    [3, 'unavailable'],
    [8, 'unavailable'],
    [10, 'unavailable'],
    [14, 'unavailable'],
    [23, 'unavailable'],
    // Extended codes are reduced to their primary code first.
    [275, 'unknown'],
    [1, 'unknown'],
  ]

  for (const [errcode, kind] of cases) {
    const handlers = createRepositoryHandlers(() =>
      throwingDatabase(Object.assign(new Error('boom'), { errcode })),
    )

    assert.deepEqual(await handlers[IPC_CHANNELS.notesList]([]), { ok: false, kind })
  }
})

// ---------------------------------------------------------------------------
// transaction rollback
// ---------------------------------------------------------------------------

/** A snippet fixture that passes validation. */
function snippetPayload(id: string, tags: string[]) {
  return { id, title: 'T', code: 'c', language: 'plaintext', tags, createdAt: 1, updatedAt: 1 }
}

test('a multi-statement insert rolls back in full when a later step fails', async () => {
  await withHandlers('rollback-insert', async (handlers, database) => {
    // Make writing a tag fail after the snippet row itself has been written.
    database.connection.exec(
      "CREATE TRIGGER fail_tag BEFORE INSERT ON snippet_tags BEGIN SELECT RAISE(ABORT, 'nope'); END",
    )

    const failed = await handlers[IPC_CHANNELS.snippetsInsert]([
      { snippet: snippetPayload('s1', ['a', 'b']) },
    ])

    assert.deepEqual(failed, { ok: false, kind: 'unknown' })
    // Neither the row nor its tags may survive a failed operation.
    assert.equal(countOf(database, 'snippets'), 0)
    assert.equal(countOf(database, 'snippet_tags'), 0)
  })
})

test('a failed snippet edit leaves the stored record untouched', async () => {
  await withHandlers('rollback-update', async (handlers, database) => {
    const created = await handlers[IPC_CHANNELS.snippetsCreate]([
      { draft: { title: 'Original', code: 'code', language: 'plaintext', tags: 'old' } },
    ])

    assert.equal(created.ok, true)
    const id = created.ok ? (created.value as { id: string }).id : ''

    database.connection.exec(
      "CREATE TRIGGER fail_tag BEFORE INSERT ON snippet_tags BEGIN SELECT RAISE(ABORT, 'nope'); END",
    )

    const failed = await handlers[IPC_CHANNELS.snippetsUpdate]([
      { id, draft: { title: 'Edited', code: 'code2', language: 'json', tags: 'new' } },
    ])

    assert.deepEqual(failed, { ok: false, kind: 'unknown' })

    const listed = await handlers[IPC_CHANNELS.snippetsList]([])
    assert.equal(listed.ok, true)

    const snippet = listed.ok
      ? (listed.value as Array<{ id: string; title: string; tags: string[] }>)[0]
      : null

    // The title edit and the tag replacement both rolled back together.
    assert.equal(snippet?.title, 'Original')
    assert.deepEqual(snippet?.tags, ['old'])
  })
})

// ---------------------------------------------------------------------------
// preload exposure
// ---------------------------------------------------------------------------

const preloadSource = readFileSync(
  fileURLToPath(new URL('../electron/preload.ts', import.meta.url)),
  'utf8',
)

test('every contract channel is reached through its own named preload method', () => {
  const referenced = new Set(
    [...preloadSource.matchAll(/IPC_CHANNELS\.([A-Za-z0-9_]+)/g)].map((match) => match[1]),
  )

  assert.deepEqual([...referenced].sort(), Object.keys(IPC_CHANNELS).sort())
})

test('the preload exposes no generic invoker and never hands out ipcRenderer', () => {
  // Every invoke names a channel constant; none forwards a dynamic value.
  assert.equal(/ipcRenderer\.invoke\((?!IPC_CHANNELS\.)/.test(preloadSource), false)
  // The bridge object is exposed; `ipcRenderer` itself never is.
  assert.ok(preloadSource.includes("contextBridge.exposeInMainWorld('x31deskDesktop', bridge)"))
  assert.equal(/exposeInMainWorld\([^)]*ipcRenderer/.test(preloadSource), false)
})
