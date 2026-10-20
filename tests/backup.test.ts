// Backup and restore, main-process half.
// ---------------------------------------------------------------------------
// These tests exercise `buildBackupDocument`, `parseBackupText`,
// `validateBackupDocument`, `applyValidatedBackup`, `exportBackup` and the
// backup IPC handlers against a throwaway database in the OS temp directory —
// never the user's profile. They pin the properties the feature promises:
//
//   * a round trip that preserves every field of every record type, snippet tag
//     order and archived payload included, and preferences;
//   * validation that refuses a foreign file, a newer version, a damaged
//     document, an oversized file, too many records, and a document whose
//     counts disagree with its own contents — all before any write;
//   * a merge that adds what is absent, skips what is identical, reports a
//     same-id/different-content clash and never overwrites it, and is idempotent;
//   * a replace that clears the four collections and nothing else, and restores
//     exactly;
//   * a failure inside the transaction leaving the workspace untouched;
//   * an export that is read back and verified, counts unreadable archive rows,
//     and is removed when it cannot be read back;
//   * handlers that leak no SQL, message or path.
//
// Dependency-free: Node's built-in test runner, type stripping and `node:sqlite`.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import type { DatabaseSync } from 'node:sqlite'

import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupDocument,
  type BackupPreferences,
  type BackupRejectionReason,
} from '@/data/ipc/contract'
import type { ArchivedItem } from '@/types/archive'
import type { Note } from '@/types/note'
import type { Snippet } from '@/types/snippet'
import type { Task } from '@/types/task'

import {
  applyValidatedBackup,
  backupFileName,
  buildBackupDocument,
  exportBackup,
  MAX_RECORDS_PER_COLLECTION,
  parseBackupText,
  sanitizeBackupPreferences,
  validateBackupDocument,
  type BackupDialogs,
  type BackupFiles,
} from '../electron/db/backup.ts'
import {
  canonicalArchiveItem,
  canonicalNote,
  canonicalSnippet,
  canonicalTask,
} from '../electron/db/canonical.ts'
import { initializeDatabase, type AppDatabase } from '../electron/db/database.ts'
import { createBackupHandlers, parseApplyRequest, parseExportRequest } from '../electron/ipc/backupHandlers.ts'
import { createSqliteArchiveRepository } from '../electron/db/repositories/archiveRepository.ts'
import { createSqliteNoteRepository } from '../electron/db/repositories/noteRepository.ts'
import { createSqliteSnippetRepository } from '../electron/db/repositories/snippetRepository.ts'
import { createSqliteTaskRepository } from '../electron/db/repositories/taskRepository.ts'

let root: string

before(() => {
  root = mkdtempSync(join(tmpdir(), 'x31desk-backup-'))
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

const PREFERENCES: BackupPreferences = {
  theme: 'dark',
  editor: { fontSize: 15, fontWeight: 'semibold', lineNumbers: false, activeLine: true, bracketMatching: false },
}

// ---------------------------------------------------------------------------
// in-memory ports
// ---------------------------------------------------------------------------

type MemoryFiles = {
  readonly files: BackupFiles
  readonly contents: Map<string, string>
  /** A size override, for exercising the size ceiling without a real file. */
  reportedSize?: number
}

function memoryFiles(): MemoryFiles {
  const contents = new Map<string, string>()

  const memory: MemoryFiles = {
    contents,
    files: {
      size: (path) => memory.reportedSize ?? contents.get(path)?.length ?? 0,
      read: (path) => {
        const value = contents.get(path)

        if (value === undefined) {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }

        return value
      },
      writeAtomic: (path, value) => {
        contents.set(path, value)
      },
      remove: (path) => {
        contents.delete(path)
      },
    },
  }

  return memory
}

function fixedDialogs(savePath: string | null, openPath: string | null): BackupDialogs {
  return {
    showSave: async () => savePath,
    showOpen: async () => openPath,
  }
}

/** A document as the format describes it, which tests then damage one field at a time. */
function validDocument(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: '0.1.0',
    databaseVersion: 1,
    exportedAt: '2026-10-19T00:00:00.000Z',
    counts: { notes: 1, tasks: 0, snippets: 0, archive: 0 },
    notes: [makeNote()],
    tasks: [],
    snippets: [],
    archive: [],
    ...overrides,
  }
}

function expectRejected(value: unknown, reason: BackupRejectionReason): string {
  const validation = validateBackupDocument(value)

  assert.equal(validation.ok, false)

  if (validation.ok) {
    throw new Error('unreachable')
  }

  assert.equal(validation.reason, reason)

  return validation.message
}

// ---------------------------------------------------------------------------
// the filename
// ---------------------------------------------------------------------------

test('the suggested filename carries the local date and the backup extension', () => {
  assert.equal(backupFileName(new Date(2026, 9, 5)), 'x31Desk-backup-2026-10-05.x31backup')
  assert.equal(backupFileName(new Date(2026, 11, 31)), 'x31Desk-backup-2026-12-31.x31backup')
})

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

test('a foreign or damaged file is refused with a reason, never a throw', () => {
  assert.equal(validateBackupDocument(null).ok, false)
  assert.equal(validateBackupDocument([]).ok, false)
  assert.equal(validateBackupDocument({ format: 'something-else' }).ok, false)
  assert.equal(parseBackupText('not json at all').ok, false)

  assert.equal(expectRejected({ format: 'x31desk.recovery' }, 'not-a-backup').length > 0, true)
})

test('a document written by a newer format version is refused as unsupported', () => {
  expectRejected(validDocument({ formatVersion: BACKUP_FORMAT_VERSION + 1 }), 'unsupported-version')
})

test('a document missing a collection, or holding a bad record, is malformed', () => {
  expectRejected(validDocument({ tasks: undefined }), 'malformed')
  expectRejected(validDocument({ notes: [{ id: '', title: 'x', content: '', createdAt: 1, updatedAt: 2 }] }), 'malformed')
  expectRejected(validDocument({ archive: [{ type: 'note' }] }), 'malformed')
})

test('counts that disagree with the records are refused', () => {
  expectRejected(validDocument({ counts: { notes: 2, tasks: 0, snippets: 0, archive: 0 } }), 'malformed')
  expectRejected(validDocument({ counts: undefined }), 'malformed')
})

test('the same id twice with different content is refused; an exact repeat is not', () => {
  const differing = validDocument({
    notes: [makeNote({ id: 'n1', title: 'A' }), makeNote({ id: 'n1', title: 'B' })],
    counts: { notes: 2, tasks: 0, snippets: 0, archive: 0 },
  })

  expectRejected(differing, 'malformed')

  const repeated = validDocument({
    notes: [makeNote(), makeNote()],
    counts: { notes: 2, tasks: 0, snippets: 0, archive: 0 },
  })

  const validation = validateBackupDocument(repeated)
  assert.equal(validation.ok, true)

  if (validation.ok) {
    assert.equal(validation.document.notes.length, 2)
    assert.deepEqual(validation.preview.counts, { notes: 2, tasks: 0, snippets: 0, archive: 0 })
  }
})

test('more records than a collection may hold is refused', () => {
  const overflowing = validDocument({
    notes: new Array(MAX_RECORDS_PER_COLLECTION + 1).fill(makeNote()),
    counts: { notes: 0, tasks: 0, snippets: 0, archive: 0 },
  })

  expectRejected(overflowing, 'too-many-records')
})

test('a valid document validates, and reports its preview', () => {
  // The `uiScale` key is one a version that shipped a UI Scale setting would
  // have written. It is unknown to this build, so it must neither break
  // validation nor be carried into the sanitised result — the theme beside it
  // still restores.
  const validation = validateBackupDocument(
    validDocument({ preferences: { theme: 'dark', uiScale: { kind: 'preset', percent: 125 } } }),
  )

  assert.equal(validation.ok, true)

  if (validation.ok) {
    assert.equal(validation.preview.appVersion, '0.1.0')
    assert.equal(validation.preview.exportedAt, '2026-10-19T00:00:00.000Z')
    assert.equal(validation.preview.hasPreferences, true)
    assert.deepEqual(validation.preview.counts, { notes: 1, tasks: 0, snippets: 0, archive: 0 })
  }
})

test('preferences are sanitised: a key is kept only when it is usable', () => {
  assert.deepEqual(sanitizeBackupPreferences({ theme: 'dark' }), { theme: 'dark' })
  // An unusable value is dropped, not replaced by a default: dropping it keeps
  // the workspace's current setting, which is the promise "absent leaves alone".
  assert.equal(sanitizeBackupPreferences({ theme: 'chartreuse' }), null)
  assert.equal(sanitizeBackupPreferences('dark'), null)
  assert.equal(sanitizeBackupPreferences(null), null)

  const sanitised = sanitizeBackupPreferences({
    theme: 'system',
    editor: { fontSize: 999, fontWeight: 'nonsense', lineNumbers: true },
    uiScale: { kind: 'preset', percent: 125 },
  })

  assert.equal(sanitised?.theme, 'system')
  // An obsolete key is ignored, not rejected: the rest of the document is still
  // restored, and the retired preference is simply not carried forward.
  assert.equal('uiScale' in sanitised, false)
  // The editor sanitiser clamps and defaults rather than discarding the object,
  // so the worst a hostile document can do is select a legal editor setting.
  assert.equal(typeof sanitised?.editor?.fontSize, 'number')
})

test('a document whose preferences are only obsolete keys reduces to none', () => {
  // The whole preferences section was one retired setting: nothing is usable,
  // so the section is omitted rather than written back as an empty object.
  assert.equal(sanitizeBackupPreferences({ uiScale: { kind: 'preset', percent: 125 } }), null)
})

// ---------------------------------------------------------------------------
// seeding and reading a workspace
// ---------------------------------------------------------------------------

type Seed = {
  readonly notes?: readonly Note[]
  readonly tasks?: readonly Task[]
  readonly snippets?: readonly Snippet[]
  readonly archive?: readonly ArchivedItem[]
}

async function seed(database: AppDatabase, data: Seed): Promise<void> {
  const notes = createSqliteNoteRepository(database.connection)
  const tasks = createSqliteTaskRepository(database.connection)
  const snippets = createSqliteSnippetRepository(database.connection)
  const archive = createSqliteArchiveRepository(database.connection)

  for (const note of data.notes ?? []) {
    await notes.insert(note)
  }

  for (const task of data.tasks ?? []) {
    await tasks.insert(task)
  }

  for (const snippet of data.snippets ?? []) {
    await snippets.insert(snippet)
  }

  for (const item of data.archive ?? []) {
    await archive.add(item)
  }
}

type CanonicalWorkspace = {
  readonly notes: string[]
  readonly tasks: string[]
  readonly snippets: string[]
  readonly archive: string[]
}

/**
 * Every record of the workspace as sorted canonical strings.
 *
 * Comparing canonical forms — rather than the objects themselves — is what makes
 * "the same workspace" mean *every persisted field, in the right shape*, and not
 * merely a matching id list. The sort removes any dependence on read order.
 */
async function canonicals(database: AppDatabase): Promise<CanonicalWorkspace> {
  const notes = await createSqliteNoteRepository(database.connection).list()
  const tasks = await createSqliteTaskRepository(database.connection).list()
  const snippets = await createSqliteSnippetRepository(database.connection).list()
  const archive = await createSqliteArchiveRepository(database.connection).list()

  return {
    notes: notes.map(canonicalNote).sort(),
    tasks: tasks.map(canonicalTask).sort(),
    snippets: snippets.map(canonicalSnippet).sort(),
    archive: archive.map(canonicalArchiveItem).sort(),
  }
}

const POPULATED: Seed = {
  notes: [
    makeNote({ id: 'n1', title: 'First', content: 'alpha', createdAt: 1, updatedAt: 2 }),
    makeNote({ id: 'n2', title: 'Second', content: 'beta\nlines', createdAt: 3, updatedAt: 4 }),
  ],
  tasks: [
    makeTask({ id: 't1', completed: false, completedAt: null, dueDate: null, priority: 'low' }),
    makeTask({ id: 't2', title: 'Done', priority: 'medium' }),
  ],
  snippets: [
    makeSnippet({ id: 's1', tags: ['zeta', 'alpha', 'mu'] }),
    makeSnippet({ id: 's2', tags: [], language: 'plaintext', code: 'plain text body' }),
  ],
  archive: [
    makeArchivedNote({ archivedAt: 900 }),
    { type: 'task', archivedAt: 500, task: makeTask({ id: 'ta' }) },
    { type: 'snippet', archivedAt: 700, snippet: makeSnippet({ id: 'sa', tags: ['x'] }) },
  ],
}

// ---------------------------------------------------------------------------
// round trips
// ---------------------------------------------------------------------------

test('a populated workspace round-trips exactly, preferences included', async () => {
  await withDatabase('rt-source.db', async (source) => {
    await withDatabase('rt-target.db', async (target) => {
      await seed(source, POPULATED)

      const built = buildBackupDocument(source.connection, '1.2.3', PREFERENCES)

      assert.deepEqual(built.document.counts, { notes: 2, tasks: 2, snippets: 2, archive: 3 })
      assert.equal(built.unreadableArchiveRows, 0)
      assert.deepEqual(built.document.preferences, PREFERENCES)
      assert.equal(built.document.appVersion, '1.2.3')
      assert.equal(built.document.format, BACKUP_FORMAT)
      assert.equal(built.document.formatVersion, BACKUP_FORMAT_VERSION)

      const validation = parseBackupText(JSON.stringify(built.document))

      assert.equal(validation.ok, true)
      if (!validation.ok) {
        return
      }

      const outcome = applyValidatedBackup(target.connection, validation.document, 'replace')

      assert.equal(outcome.outcome, 'applied')

      if (outcome.outcome !== 'applied') {
        return
      }

      assert.deepEqual(outcome.counts, { notes: 2, tasks: 2, snippets: 2, archive: 3 })
      assert.deepEqual(outcome.conflicts, [])
      assert.deepEqual(outcome.preferences, PREFERENCES)

      assert.deepEqual(await canonicals(target), await canonicals(source))

      // Tag order survives, because it is part of the record, not the read.
      const snippets = await createSqliteSnippetRepository(target.connection).list()
      const s1 = snippets.find((snippet) => snippet.id === 's1')
      assert.deepEqual(s1?.tags, ['zeta', 'alpha', 'mu'])
    })
  })
})

test('an empty workspace round-trips as an empty workspace', async () => {
  await withDatabase('empty-source.db', async (source) => {
    await withDatabase('empty-target.db', async (target) => {
      const built = buildBackupDocument(source.connection, '1.0.0', null)

      assert.deepEqual(built.document.counts, { notes: 0, tasks: 0, snippets: 0, archive: 0 })
      assert.equal(built.document.preferences, undefined)

      const validation = validateBackupDocument(built.document)
      assert.equal(validation.ok, true)
      if (!validation.ok) {
        return
      }

      assert.equal(validation.preview.hasPreferences, false)

      const outcome = applyValidatedBackup(target.connection, validation.document, 'merge')
      assert.equal(outcome.outcome, 'applied')
      assert.deepEqual(await canonicals(target), { notes: [], tasks: [], snippets: [], archive: [] })
    })
  })
})

test('a large workspace round-trips exactly', async () => {
  await withDatabase('large-source.db', async (source) => {
    await withDatabase('large-target.db', async (target) => {
      const notes = Array.from({ length: 1000 }, (_, index) =>
        makeNote({ id: `n${index}`, title: `Note ${index}`, content: `Body ${index}`, createdAt: index, updatedAt: index + 1 }),
      )
      const tasks = Array.from({ length: 1000 }, (_, index) =>
        makeTask({ id: `t${index}`, title: `Task ${index}`, createdAt: index, updatedAt: index }),
      )
      const snippets = Array.from({ length: 500 }, (_, index) =>
        makeSnippet({ id: `s${index}`, tags: [`${index}`, 'shared'] }),
      )
      const archive = Array.from({ length: 500 }, (_, index) =>
        makeArchivedNote({ archivedAt: index, note: makeNote({ id: `a${index}` }) }),
      )

      await seed(source, { notes, tasks, snippets, archive })

      const built = buildBackupDocument(source.connection, '1.0.0', null)
      const validation = validateBackupDocument(built.document)

      assert.equal(validation.ok, true)
      if (!validation.ok) {
        return
      }

      assert.deepEqual(validation.preview.counts, { notes: 1000, tasks: 1000, snippets: 500, archive: 500 })

      const outcome = applyValidatedBackup(target.connection, validation.document, 'replace')
      assert.equal(outcome.outcome, 'applied')
      assert.deepEqual(await canonicals(target), await canonicals(source))
    })
  })
})

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

test('a merge adds what is absent, skips what matches, and reports a clash without overwriting', async () => {
  await withDatabase('merge-source.db', async (source) => {
    await withDatabase('merge-target.db', async (target) => {
      await seed(source, {
        notes: [makeNote({ id: 'n1', title: 'From backup' }), makeNote({ id: 'n2', title: 'Also from backup' })],
      })
      await seed(target, {
        notes: [makeNote({ id: 'n1', title: 'Mine, do not touch' }), makeNote({ id: 'n2', title: 'Also from backup' })],
      })

      const built = buildBackupDocument(source.connection, '1.0.0', null)
      const validation = validateBackupDocument(built.document)
      assert.equal(validation.ok, true)
      if (!validation.ok) {
        return
      }

      const outcome = applyValidatedBackup(target.connection, validation.document, 'merge')

      assert.equal(outcome.outcome, 'applied')
      if (outcome.outcome !== 'applied') {
        return
      }

      assert.deepEqual(outcome.counts, { notes: 0, tasks: 0, snippets: 0, archive: 0 })
      assert.deepEqual(outcome.unchanged, { notes: 1, tasks: 0, snippets: 0, archive: 0 })
      assert.deepEqual(outcome.conflicts, [{ collection: 'notes', id: 'n1' }])

      const notes = await createSqliteNoteRepository(target.connection).list()
      assert.equal(notes.find((note) => note.id === 'n1')?.title, 'Mine, do not touch')
    })
  })
})

test('a merge inserts records the workspace does not hold at all', async () => {
  await withDatabase('merge-add-source.db', async (source) => {
    await withDatabase('merge-add-target.db', async (target) => {
      await seed(source, { notes: [makeNote({ id: 'n1' })], tasks: [makeTask({ id: 't1' })] })
      await seed(target, { snippets: [makeSnippet({ id: 's9' })] })

      const built = buildBackupDocument(source.connection, '1.0.0', null)
      const validation = validateBackupDocument(built.document)
      assert.equal(validation.ok, true)
      if (!validation.ok) {
        return
      }

      const outcome = applyValidatedBackup(target.connection, validation.document, 'merge')

      assert.equal(outcome.outcome, 'applied')
      if (outcome.outcome !== 'applied') {
        return
      }

      assert.deepEqual(outcome.counts, { notes: 1, tasks: 1, snippets: 0, archive: 0 })
      assert.deepEqual(outcome.conflicts, [])

      const notes = await createSqliteNoteRepository(target.connection).list()
      const snippets = await createSqliteSnippetRepository(target.connection).list()
      assert.equal(notes.length, 1)
      assert.equal(snippets.length, 1)
    })
  })
})

test('importing the same backup twice is idempotent', async () => {
  await withDatabase('idempotent-source.db', async (source) => {
    await withDatabase('idempotent-target.db', async (target) => {
      await seed(source, POPULATED)

      const built = buildBackupDocument(source.connection, '1.0.0', null)
      const validation = validateBackupDocument(built.document)
      assert.equal(validation.ok, true)
      if (!validation.ok) {
        return
      }

      const first = applyValidatedBackup(target.connection, validation.document, 'merge')
      const second = applyValidatedBackup(target.connection, validation.document, 'merge')

      assert.equal(first.outcome, 'applied')
      assert.equal(second.outcome, 'applied')

      if (second.outcome !== 'applied') {
        return
      }

      assert.deepEqual(second.counts, { notes: 0, tasks: 0, snippets: 0, archive: 0 })
      assert.deepEqual(second.unchanged, { notes: 2, tasks: 2, snippets: 2, archive: 3 })
      assert.deepEqual(second.conflicts, [])
      assert.deepEqual(await canonicals(target), await canonicals(source))
    })
  })
})

// ---------------------------------------------------------------------------
// replace
// ---------------------------------------------------------------------------

test('a replace clears the workspace, restores the backup, and leaves the marker and vault alone', async () => {
  await withDatabase('replace-source.db', async (source) => {
    await withDatabase('replace-target.db', async (target) => {
      await seed(source, { notes: [makeNote({ id: 'keep' })] })
      await seed(target, { notes: [makeNote({ id: 'discard' })], tasks: [makeTask({ id: 'discard-task' })] })

      // Neither of these is workspace data, and neither may be touched.
      target.connection
        .prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
        .run('migration:localStorage-import', '{"version":1}')
      target.connection
        .prepare(
          'INSERT INTO archive_corruption (type, record_id, archived_at, data, detected_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run('note', 'bad', 1, '{broken', 2)

      const built = buildBackupDocument(source.connection, '1.0.0', null)
      const validation = validateBackupDocument(built.document)
      assert.equal(validation.ok, true)
      if (!validation.ok) {
        return
      }

      const outcome = applyValidatedBackup(target.connection, validation.document, 'replace')

      assert.equal(outcome.outcome, 'applied')
      if (outcome.outcome !== 'applied') {
        return
      }

      assert.deepEqual(outcome.counts, { notes: 1, tasks: 0, snippets: 0, archive: 0 })
      assert.equal(outcome.mode, 'replace')

      const notes = await createSqliteNoteRepository(target.connection).list()
      assert.deepEqual(notes.map((note) => note.id), ['keep'])

      assert.equal(
        target.connection.prepare('SELECT COUNT(*) AS count FROM meta').get()?.['count'],
        1,
      )
      assert.equal(
        target.connection.prepare('SELECT COUNT(*) AS count FROM archive_corruption').get()?.['count'],
        1,
      )
    })
  })
})

// ---------------------------------------------------------------------------
// rollback
// ---------------------------------------------------------------------------

test('a failure inside a replace transaction leaves the workspace exactly as it was', async () => {
  await withDatabase('rollback-replace.db', async (database) => {
    await seed(database, { notes: [makeNote({ id: 'survivor', title: 'Untouched' })] })

    const before = await canonicals(database)

    // A circular extra property passes validation (the canonical form reads only
    // known fields) but throws when the archive row is serialised for SQLite —
    // after the workspace has already been cleared.
    const circular: ArchivedItem & { self?: unknown } = makeArchivedNote({ archivedAt: 1 })
    circular.self = circular

    const document = buildBackupDocument(database.connection, '1.0.0', null).document
    const poisoned: BackupDocument = { ...document, notes: [makeNote({ id: 'new' })], archive: [circular] }

    assert.throws(() => applyValidatedBackup(database.connection, poisoned, 'replace'))

    assert.deepEqual(await canonicals(database), before)
  })
})

test('a failure inside a merge transaction leaves the workspace exactly as it was', async () => {
  await withDatabase('rollback-merge.db', async (database) => {
    await seed(database, { notes: [makeNote({ id: 'survivor' })] })

    const before = await canonicals(database)

    const circular: ArchivedItem & { self?: unknown } = makeArchivedNote({ archivedAt: 2 })
    circular.self = circular

    const document = buildBackupDocument(database.connection, '1.0.0', null).document
    const poisoned: BackupDocument = { ...document, notes: [makeNote({ id: 'added' })], archive: [circular] }

    assert.throws(() => applyValidatedBackup(database.connection, poisoned, 'merge'))

    assert.deepEqual(await canonicals(database), before)
  })
})

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

test('an export writes a file that reads back as the same workspace', async () => {
  await withDatabase('export.db', async (database) => {
    await seed(database, POPULATED)

    const memory = memoryFiles()
    const path = join(root, 'out', 'x31Desk-backup-2026-10-19.x31backup')

    const outcome = await exportBackup({
      database: database.connection,
      dialogs: fixedDialogs(path, null),
      files: memory.files,
      appVersion: '1.0.0',
      preferences: PREFERENCES,
    })

    assert.equal(outcome.outcome, 'written')
    if (outcome.outcome !== 'written') {
      return
    }

    assert.equal(outcome.fileName, 'x31Desk-backup-2026-10-19.x31backup')
    assert.deepEqual(outcome.counts, { notes: 2, tasks: 2, snippets: 2, archive: 3 })
    assert.equal(outcome.unreadableArchiveRows, 0)
    assert.equal(outcome.preferencesIncluded, true)
    assert.equal(outcome.bytes > 0, true)

    const written = memory.contents.get(path)
    assert.equal(typeof written, 'string')

    const reread = parseBackupText(written ?? '')
    assert.equal(reread.ok, true)

    if (reread.ok) {
      assert.deepEqual(reread.document.counts, outcome.counts)
      assert.deepEqual(reread.document.preferences, PREFERENCES)
    }
  })
})

test('a cancelled save dialog writes nothing', async () => {
  await withDatabase('export-cancel.db', async (database) => {
    const memory = memoryFiles()

    const outcome = await exportBackup({
      database: database.connection,
      dialogs: fixedDialogs(null, null),
      files: memory.files,
      appVersion: '1.0.0',
      preferences: null,
    })

    assert.deepEqual(outcome, { outcome: 'cancelled' })
    assert.equal(memory.contents.size, 0)
  })
})

test('an export counts archive rows it cannot read instead of dropping them silently', async () => {
  await withDatabase('export-unreadable.db', async (database) => {
    await seed(database, { notes: [makeNote()] })
    database.connection
      .prepare('INSERT INTO archive (type, record_id, archived_at, data) VALUES (?, ?, ?, ?)')
      .run('note', 'broken', 10, '{not json')

    const memory = memoryFiles()
    const path = join(root, 'unreadable.x31backup')

    const outcome = await exportBackup({
      database: database.connection,
      dialogs: fixedDialogs(path, null),
      files: memory.files,
      appVersion: '1.0.0',
      preferences: null,
    })

    assert.equal(outcome.outcome, 'written')
    if (outcome.outcome !== 'written') {
      return
    }

    assert.equal(outcome.unreadableArchiveRows, 1)

    const reread = parseBackupText(memory.contents.get(path) ?? '')
    assert.equal(reread.ok, true)
    if (reread.ok) {
      assert.deepEqual(reread.document.counts, { notes: 1, tasks: 0, snippets: 0, archive: 0 })
    }
  })
})

test('an export that cannot be read back is removed, not left behind', async () => {
  await withDatabase('export-verify.db', async (database) => {
    await seed(database, { notes: [makeNote()] })

    const path = join(root, 'verify.x31backup')
    let written = ''

    const files: BackupFiles = {
      size: () => written.length,
      writeAtomic: (_path, contents) => {
        // Write it, then corrupt it: the re-read below must not match.
        written = '{ "format": "x31desk.backup", "formatVersion": 1 }'
        void contents
      },
      read: () => written,
      remove: () => {
        written = ''
      },
    }

    const outcome = await exportBackup({
      database: database.connection,
      dialogs: fixedDialogs(path, null),
      files,
      appVersion: '1.0.0',
      preferences: null,
    })

    assert.deepEqual(outcome, { outcome: 'failed', kind: 'unknown' })
    assert.equal(written, '')
  })
})

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

test('an unavailable database fails every backup channel as unavailable', async () => {
  const handlers = createBackupHandlers({
    getDatabase: () => null,
    dialogs: fixedDialogs('save', 'open'),
    files: memoryFiles().files,
    appVersion: '1.0.0',
  })

  assert.deepEqual(await handlers.export([{ preferences: null }]), { outcome: 'failed', kind: 'unavailable' })
  assert.deepEqual(await handlers.inspect(), { outcome: 'failed', kind: 'unavailable' })
  assert.deepEqual(await handlers.apply([{ document: validDocument(), mode: 'merge' }]), {
    outcome: 'failed',
    kind: 'unavailable',
  })
})

test('the inspect handler reports cancelled, ready and rejected without throwing', async () => {
  await withDatabase('handler-inspect.db', async (database) => {
    const memory = memoryFiles()

    const cancelled = createBackupHandlers({
      getDatabase: () => database.connection,
      dialogs: fixedDialogs(null, null),
      files: memory.files,
      appVersion: '1.0.0',
    })

    assert.deepEqual(await cancelled.inspect(), { outcome: 'cancelled' })

    const path = join(root, 'inspect.x31backup')
    memory.contents.set(path, JSON.stringify(validDocument({ preferences: { theme: 'light' } })))

    const ready = createBackupHandlers({
      getDatabase: () => database.connection,
      dialogs: fixedDialogs(null, path),
      files: memory.files,
      appVersion: '1.0.0',
    })

    const outcome = await ready.inspect()

    assert.equal(outcome.outcome, 'ready')
    if (outcome.outcome === 'ready') {
      assert.equal(outcome.preview.hasPreferences, true)
      assert.deepEqual(outcome.preview.counts, { notes: 1, tasks: 0, snippets: 0, archive: 0 })
      assert.equal(outcome.fileName, 'inspect.x31backup')
    }

    memory.contents.set(path, 'not a backup')

    const rejected = await ready.inspect()

    assert.equal(rejected.outcome, 'rejected')
    if (rejected.outcome === 'rejected') {
      assert.equal(rejected.reason, 'not-a-backup')
      assert.equal(rejected.message.length > 0, true)
    }
  })
})

test('the inspect handler refuses an oversized file on its size alone', async () => {
  await withDatabase('handler-large.db', async (database) => {
    const memory = memoryFiles()
    memory.reportedSize = 512 * 1024 * 1024

    const handlers = createBackupHandlers({
      getDatabase: () => database.connection,
      dialogs: fixedDialogs(null, join(root, 'huge.x31backup')),
      files: memory.files,
      appVersion: '1.0.0',
    })

    const outcome = await handlers.inspect()

    assert.equal(outcome.outcome, 'rejected')
    if (outcome.outcome === 'rejected') {
      assert.equal(outcome.reason, 'too-large')
    }
  })
})

test('the apply handler re-validates the document it is handed', async () => {
  await withDatabase('handler-apply.db', async (database) => {
    const handlers = createBackupHandlers({
      getDatabase: () => database.connection,
      dialogs: fixedDialogs(null, null),
      files: memoryFiles().files,
      appVersion: '1.0.0',
    })

    const foreign = handlers.apply([{ document: { format: 'x31desk.recovery' }, mode: 'merge' }])

    assert.equal(foreign.outcome, 'rejected')
    if (foreign.outcome === 'rejected') {
      assert.equal(foreign.reason, 'not-a-backup')
    }

    // Too many arguments, no arguments, and an unknown mode are all refused.
    assert.equal(handlers.apply([]).outcome, 'rejected')
    assert.equal(handlers.apply([{ document: validDocument(), mode: 'merge' }, 'extra']).outcome, 'rejected')
    assert.equal(handlers.apply([{ document: validDocument(), mode: 'wipe' }]).outcome, 'rejected')
  })
})

test('the apply handler merges a valid document and echoes sanitised preferences', async () => {
  await withDatabase('handler-apply-ok.db', async (database) => {
    const handlers = createBackupHandlers({
      getDatabase: () => database.connection,
      dialogs: fixedDialogs(null, null),
      files: memoryFiles().files,
      appVersion: '1.0.0',
    })

    const outcome = handlers.apply([
      { document: validDocument({ preferences: { theme: 'dark' } }), mode: 'merge' },
    ])

    assert.equal(outcome.outcome, 'applied')
    if (outcome.outcome === 'applied') {
      assert.deepEqual(outcome.counts, { notes: 1, tasks: 0, snippets: 0, archive: 0 })
      assert.deepEqual(outcome.preferences, { theme: 'dark' })
    }

    const notes = await createSqliteNoteRepository(database.connection).list()
    assert.equal(notes.length, 1)
  })
})

test('a database exception becomes a classified failure that leaks nothing', async () => {
  const boom = Object.assign(new Error('disk exploded at C:\\secret\\x31desk.db'), { errcode: 13 })
  const failing = {
    exec: () => undefined,
    prepare() {
      throw boom
    },
  } as unknown as DatabaseSync

  const handlers = createBackupHandlers({
    getDatabase: () => failing,
    dialogs: fixedDialogs(join(root, 'leak.x31backup'), join(root, 'leak.x31backup')),
    files: memoryFiles().files,
    appVersion: '1.0.0',
  })

  const exported = await handlers.export([{ preferences: null }])

  assert.deepEqual(exported, { outcome: 'failed', kind: 'quota' })
  assert.equal(JSON.stringify(exported).includes('secret'), false)
  assert.equal(JSON.stringify(exported).includes('exploded'), false)
})

test('the request parsers accept only the documented shapes', () => {
  assert.deepEqual(parseExportRequest({ preferences: null }), { preferences: null })
  assert.deepEqual(parseExportRequest({}), { preferences: null })
  assert.deepEqual(parseExportRequest({ preferences: { theme: 'dark' } }), { preferences: { theme: 'dark' } })
  assert.equal(parseExportRequest('nope'), null)
  assert.equal(parseExportRequest(null), null)

  assert.deepEqual(parseApplyRequest({ document: { a: 1 }, mode: 'replace' }), {
    document: { a: 1 },
    mode: 'replace',
  })
  assert.equal(parseApplyRequest({ document: { a: 1 }, mode: 'merge' })?.mode, 'merge')
  assert.equal(parseApplyRequest({ document: { a: 1 }, mode: 'other' }), null)
  assert.equal(parseApplyRequest({ mode: 'merge' }), null)
  assert.equal(parseApplyRequest(null), null)
})

