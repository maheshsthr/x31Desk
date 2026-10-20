// Archive corruption safety.
// ---------------------------------------------------------------------------
// The `localStorage` archive reader preserves an unreadable collection verbatim
// under `x31desk:archive:unreadable` (write-once) before it drops the bad
// entries, so nothing the user set aside disappears without a trace. The SQLite
// adapter must offer the same guarantee: a row it cannot read back is copied —
// bytes and identity — into the `archive_corruption` table before it is left out
// of `list()`, and nothing removes it except an explicit archive reset.
//
// These tests pin that behaviour: the payload is preserved *exactly*, is
// write-once, is never moved or rewritten in the live table, and never restores,
// imports or deletes anything on its own. The last test establishes the
// `localStorage` guarantee the SQLite vault mirrors.
//
// Dependency-free: Node's built-in test runner, type stripping and `node:sqlite`.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { createLocalArchiveRepository } from '@/data/archiveRepository'
import { QUARANTINE_KEYS } from '@/data/quarantine'
import type { ArchivedItem } from '@/types/archive'

import { createArchiveQuarantine } from '../electron/db/archiveQuarantine.ts'
import { initializeDatabase, type AppDatabase } from '../electron/db/database.ts'
import { createSqliteArchiveRepository } from '../electron/db/repositories/archiveRepository.ts'

let root: string

before(() => {
  root = mkdtempSync(join(tmpdir(), 'x31desk-archive-corruption-'))
})

after(() => {
  rmSync(root, { recursive: true, force: true })
})

async function withDatabase(name: string, run: (database: AppDatabase) => Promise<void>) {
  const database = initializeDatabase(join(root, name))

  try {
    await run(database)
  } finally {
    database.close()
  }
}

/** Writes an archive row the adapter would never produce itself. */
function insertRawRow(
  database: AppDatabase,
  type: string,
  recordId: string,
  archivedAt: number,
  data: string,
): void {
  database.connection
    .prepare('INSERT INTO archive (type, record_id, archived_at, data) VALUES (?, ?, ?, ?)')
    .run(type, recordId, archivedAt, data)
}

function validEntry(id: string, archivedAt: number): ArchivedItem {
  return {
    type: 'note',
    archivedAt,
    note: { id, title: 'Valid', content: 'Body', createdAt: 1, updatedAt: 1 },
  }
}

// ---------------------------------------------------------------------------
// preservation
// ---------------------------------------------------------------------------

test('a malformed archive row is preserved verbatim and never reaches the list', async () => {
  await withDatabase('malformed-json', async (database) => {
    const archive = createSqliteArchiveRepository(database.connection)
    const good = validEntry('n1', 100)

    await archive.add(good)
    insertRawRow(database, 'note', 'broken', 999, 'not json')

    assert.deepEqual(await archive.list(), [good])

    const preserved = createArchiveQuarantine(database.connection).list()

    assert.equal(preserved.length, 1)
    assert.equal(preserved[0]?.type, 'note')
    assert.equal(preserved[0]?.recordId, 'broken')
    assert.equal(preserved[0]?.archivedAt, 999)
    assert.equal(preserved[0]?.data, 'not json')
    assert.ok(Number.isFinite(preserved[0]?.detectedAt))
  })
})

test('a row that is valid JSON but not an archived item is preserved too', async () => {
  await withDatabase('valid-json-bad-shape', async (database) => {
    const archive = createSqliteArchiveRepository(database.connection)
    const shape = '{"type":"note","archivedAt":5}'

    insertRawRow(database, 'note', 'shapeless', 5, shape)

    assert.deepEqual(await archive.list(), [])

    const preserved = createArchiveQuarantine(database.connection).list()

    assert.equal(preserved.length, 1)
    assert.equal(preserved[0]?.data, shape)
  })
})

test('preservation is write-once: a later payload at the same key cannot replace it', async () => {
  await withDatabase('write-once', async (database) => {
    const archive = createSqliteArchiveRepository(database.connection)

    insertRawRow(database, 'note', 'k1', 1, 'first corruption')
    await archive.list()

    database.connection
      .prepare('UPDATE archive SET data = ? WHERE type = ? AND record_id = ?')
      .run('second corruption', 'note', 'k1')
    await archive.list()

    const preserved = createArchiveQuarantine(database.connection).list()

    assert.equal(preserved.length, 1)
    assert.equal(preserved[0]?.data, 'first corruption')
  })
})

test('the malformed row itself is never moved, edited or deleted by a read', async () => {
  await withDatabase('row-untouched', async (database) => {
    const archive = createSqliteArchiveRepository(database.connection)

    insertRawRow(database, 'note', 'k1', 42, '  {"a":1}\n\tnot-json \u2713 ')
    await archive.list()

    const row = database.connection
      .prepare('SELECT type, record_id, archived_at, data FROM archive WHERE record_id = ?')
      .get('k1')

    assert.equal(row?.type, 'note')
    assert.equal(row?.archived_at, 42)
    assert.equal(row?.data, '  {"a":1}\n\tnot-json \u2713 ')
  })
})

test('preservation is best effort: a vault that cannot be written still lets the archive open', async () => {
  await withDatabase('best-effort', async (database) => {
    const archive = createSqliteArchiveRepository(database.connection)
    const good = validEntry('n1', 100)

    await archive.add(good)

    // Take the vault away out from under the adapter.
    database.connection.exec('DROP TABLE archive_corruption')
    insertRawRow(database, 'note', 'broken', 999, 'not json')

    // The read must still resolve, with the readable entries.
    assert.deepEqual(await archive.list(), [good])
  })
})

test('an empty vault reports nothing preserved', async () => {
  await withDatabase('empty-vault', async (database) => {
    const quarantine = createArchiveQuarantine(database.connection)

    assert.equal(quarantine.has(), false)
    assert.deepEqual(quarantine.list(), [])
  })
})

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

test('an explicit archive clear drops the vault; nothing else does', async () => {
  await withDatabase('clear-vault', async (database) => {
    const archive = createSqliteArchiveRepository(database.connection)
    const quarantine = createArchiveQuarantine(database.connection)

    insertRawRow(database, 'note', 'broken', 1, 'not json')
    await archive.list()
    assert.equal(quarantine.has(), true)

    // Removing another entry must leave the preserved payload alone.
    await archive.remove('note', 'missing')
    assert.equal(quarantine.has(), true)

    // A reset is the one moment the user asked for archived data to be gone.
    await archive.clear()
    assert.equal(quarantine.has(), false)
    assert.deepEqual(quarantine.list(), [])
  })
})

// ---------------------------------------------------------------------------
// localStorage parity
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
  }
}

function installStorage(initial = {}) {
  const storage = createFakeStorage(initial)
  globalThis.window = { localStorage: storage }
  return storage
}

test('the localStorage reader, whose guarantee the vault mirrors, preserves exact bytes write-once', async () => {
  // One valid entry and one that is not an archived item: the reader keeps the
  // valid one and quarantines the whole original payload, byte-for-byte.
  const raw =
    '[{"type":"note","archivedAt":1,"note":{"id":"n1","title":"T","content":"C","createdAt":1,"updatedAt":1}},"not-an-item"]'
  const storage = installStorage({ 'x31desk:archive': raw })
  const repository = createLocalArchiveRepository()

  const items = await repository.list()

  assert.equal(items.length, 1)
  assert.equal(items[0].type, 'note')
  assert.equal(storage.getItem(QUARANTINE_KEYS.archive), raw)

  // A second, different corruption can never replace the first preserved bytes.
  storage.setItem('x31desk:archive', '["different"]')
  await repository.list()
  assert.equal(storage.getItem(QUARANTINE_KEYS.archive), raw)

  // Only the explicit reset removes the quarantined bytes, exactly as the vault
  // is only emptied by `archive.clear()`.
  await repository.clear()
  assert.equal(storage.getItem(QUARANTINE_KEYS.archive), null)
  assert.equal(storage.getItem('x31desk:archive'), null)
})
