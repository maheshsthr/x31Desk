// Backup and restore over the *real* filesystem.
// ---------------------------------------------------------------------------
// `tests/backup.test.ts` exercises the format, the merge and the export
// orchestration against an in-memory stand-in for the filesystem, which is the
// right way to test what a backup contains. This file covers the other half: the
// small `node:fs` port the shell actually uses, and the three IPC handlers wired
// to it. A backup that validates in memory but cannot be written, re-read and
// imported from a real path is not a backup, so the round trip is run here end
// to end with real files in a real temporary directory.
//
// What is pinned:
//
//   * `writeAtomic` leaves the target and no staging sibling, even when it
//     overwrites an existing file;
//   * a real export reports the true byte size and a real import reads the same
//     workspace back through a *second*, independent set of handlers — which is
//     only possible because the two calls share no state;
//   * `remove` tolerates a path that is already gone, which the verification
//     failure path relies on.
//
// Dependency-free: Node's built-in test runner and type stripping.
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import type { ArchivedItem } from '@/types/archive'
import type { Note } from '@/types/note'
import type { Snippet } from '@/types/snippet'
import type { Task } from '@/types/task'
import { nodeBackupFiles } from '../electron/db/backupFiles.ts'
import { initializeDatabase } from '../electron/db/database.ts'
import { createSqliteArchiveRepository } from '../electron/db/repositories/archiveRepository.ts'
import { createSqliteNoteRepository } from '../electron/db/repositories/noteRepository.ts'
import { createSqliteSnippetRepository } from '../electron/db/repositories/snippetRepository.ts'
import { createSqliteTaskRepository } from '../electron/db/repositories/taskRepository.ts'
import { createBackupHandlers } from '../electron/ipc/backupHandlers.ts'

const ROOT = mkdtempSync(join(tmpdir(), 'x31desk-backup-fs-'))

after(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

const NOTE: Note = {
  id: 'fs-note',
  title: 'Real file',
  content: 'written to disk',
  createdAt: 1000,
  updatedAt: 2000,
}

const TASK: Task = {
  id: 'fs-task',
  title: 'Check the bytes',
  description: '',
  dueDate: null,
  priority: 'medium',
  completed: false,
  createdAt: 1000,
  updatedAt: 2000,
  completedAt: null,
}

const SNIPPET: Snippet = {
  id: 'fs-snippet',
  title: 'Round trip',
  code: 'const ok = true',
  language: 'typescript',
  tags: ['backup'],
  createdAt: 1000,
  updatedAt: 2000,
}

const ARCHIVED: ArchivedItem = { type: 'note', archivedAt: 3000, note: NOTE }

/** A dialog port that always answers with the same path. */
function dialogsFor(path: string | null) {
  return {
    showSave: async () => path,
    showOpen: async () => path,
  }
}

/** A dialog port that cancels both prompts. */
const NO_DIALOGS = { showSave: async () => null, showOpen: async () => null }

test('writeAtomic writes the target and leaves no staging file', () => {
  const directory = mkdtempSync(join(ROOT, 'atomic-'))
  const target = join(directory, 'backup.x31backup')

  nodeBackupFiles.writeAtomic(target, 'first')

  assert.equal(nodeBackupFiles.read(target), 'first')
  assert.equal(nodeBackupFiles.size(target), 5)

  // Overwriting replaces the contents and still leaves nothing behind.
  nodeBackupFiles.writeAtomic(target, 'second payload')
  assert.equal(nodeBackupFiles.read(target), 'second payload')
  assert.deepEqual(
    readdirSync(directory).filter((name) => name !== 'backup.x31backup'),
    [],
  )
})

test('remove deletes a file and tolerates one that is already gone', () => {
  const directory = mkdtempSync(join(ROOT, 'remove-'))
  const target = join(directory, 'backup.x31backup')

  nodeBackupFiles.writeAtomic(target, 'x')
  nodeBackupFiles.remove(target)

  assert.throws(() => statSync(target), /ENOENT/)
  // Called again — as the verification-failure path may do — it is a no-op.
  assert.doesNotThrow(() => nodeBackupFiles.remove(target))
})

test('an export writes a real file that a separate import round-trips', async () => {
  const sourceDirectory = join(ROOT, 'source')
  const targetDirectory = join(ROOT, 'target')
  const file = join(ROOT, 'x31Desk-backup-2026-10-19.x31backup')

  const source = initializeDatabase(sourceDirectory)
  await createSqliteNoteRepository(source.connection).insert(NOTE)
  await createSqliteTaskRepository(source.connection).insert(TASK)
  await createSqliteSnippetRepository(source.connection).insert(SNIPPET)
  await createSqliteArchiveRepository(source.connection).add(ARCHIVED)

  const exporter = createBackupHandlers({
    getDatabase: () => source.connection,
    dialogs: dialogsFor(file),
    appVersion: '9.9.9',
  })

  const exported = await exporter.export([{ preferences: { theme: 'dark' } }])
  assert.equal(exported.outcome, 'written')

  if (exported.outcome !== 'written') {
    source.close()
    return
  }

  assert.equal(exported.path, file)
  assert.equal(exported.fileName, 'x31Desk-backup-2026-10-19.x31backup')
  assert.equal(exported.counts.notes, 1)
  assert.equal(exported.counts.tasks, 1)
  assert.equal(exported.counts.snippets, 1)
  assert.equal(exported.counts.archive, 1)
  assert.equal(exported.preferencesIncluded, true)
  // The reported size is the file's real size, not an estimate.
  assert.equal(exported.bytes, statSync(file).size)
  assert.ok(exported.bytes > 0)
  assert.deepEqual(
    readdirSync(ROOT).filter((name) => name.endsWith('.tmp')),
    [],
  )

  source.close()

  // A completely separate handler set, with its own database provider and its
  // own dialogs. Nothing is shared with the exporter, so anything that survives
  // this leg came out of the file.
  const imported = initializeDatabase(targetDirectory)
  const importer = createBackupHandlers({
    getDatabase: () => imported.connection,
    dialogs: dialogsFor(file),
    appVersion: '9.9.9',
  })

  const inspected = await importer.inspect()
  assert.equal(inspected.outcome, 'ready')

  if (inspected.outcome !== 'ready') {
    imported.close()
    return
  }

  assert.equal(inspected.fileName, 'x31Desk-backup-2026-10-19.x31backup')
  assert.equal(inspected.preview.appVersion, '9.9.9')
  assert.equal(inspected.preview.hasPreferences, true)
  assert.deepEqual(inspected.preview.counts, { notes: 1, tasks: 1, snippets: 1, archive: 1 })

  const applied = importer.apply([{ document: inspected.document, mode: 'merge' }])
  assert.equal(applied.outcome, 'applied')

  if (applied.outcome !== 'applied') {
    imported.close()
    return
  }

  assert.deepEqual(applied.counts, { notes: 1, tasks: 1, snippets: 1, archive: 1 })
  assert.deepEqual(applied.conflicts, [])
  assert.deepEqual(applied.preferences, { theme: 'dark' })

  assert.deepEqual(
    (await createSqliteNoteRepository(imported.connection).list()).map((note) => note.id),
    [NOTE.id],
  )
  assert.deepEqual(
    (await createSqliteTaskRepository(imported.connection).list()).map((task) => task.id),
    [TASK.id],
  )
  assert.deepEqual(
    (await createSqliteSnippetRepository(imported.connection).list()).map((snippet) => snippet.id),
    [SNIPPET.id],
  )
  assert.deepEqual(
    (await createSqliteArchiveRepository(imported.connection).list()).map((item) => item.type),
    ['note'],
  )

  // Importing the same real file again adds nothing and overwrites nothing.
  const again = importer.apply([{ document: inspected.document, mode: 'merge' }])
  assert.equal(again.outcome, 'applied')

  if (again.outcome === 'applied') {
    assert.deepEqual(again.counts, { notes: 0, tasks: 0, snippets: 0, archive: 0 })
    assert.deepEqual(again.unchanged, { notes: 1, tasks: 1, snippets: 1, archive: 1 })
    assert.deepEqual(again.conflicts, [])
  }

  imported.close()
})

test('a file the user cancels on is never written or read', async () => {
  const source = initializeDatabase(join(ROOT, 'cancel-source'))
  await createSqliteNoteRepository(source.connection).insert(NOTE)

  const handlers = createBackupHandlers({
    getDatabase: () => source.connection,
    dialogs: NO_DIALOGS,
    appVersion: '9.9.9',
  })

  assert.deepEqual(await handlers.export([{ preferences: null }]), { outcome: 'cancelled' })
  assert.deepEqual(await handlers.inspect(), { outcome: 'cancelled' })

  source.close()
})

test('a real file that is not a backup is refused before anything is written', async () => {
  const directory = join(ROOT, 'not-a-backup')
  const database = initializeDatabase(directory)
  const file = join(ROOT, 'holiday-photo.x31backup')

  writeFileSync(file, 'this is definitely not a backup', 'utf8')

  const handlers = createBackupHandlers({
    getDatabase: () => database.connection,
    dialogs: dialogsFor(file),
    appVersion: '9.9.9',
  })

  const inspected = await handlers.inspect()
  assert.equal(inspected.outcome, 'rejected')

  if (inspected.outcome === 'rejected') {
    assert.equal(inspected.reason, 'not-a-backup')
    assert.ok(inspected.message.length > 0)
  }

  // The workspace is untouched — importing was never reached.
  assert.deepEqual(await createSqliteNoteRepository(database.connection).list(), [])

  database.close()
})
