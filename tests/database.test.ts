// Focused tests for the main process's SQLite database:
//   * `initializeDatabase` — creating, migrating and configuring the file, and
//     failing loudly rather than handing back an unusable handle;
//   * `runMigrations` — forward-only, transactional versioning that advances
//     `PRAGMA user_version` only after a step succeeds and never leaves a
//     partial schema behind.
//
// These run under plain Node, not Electron: the database module takes its
// directory as an argument and never touches `app.getPath`, so the same code
// the main process runs can be exercised directly.
//
// Dependency-free: Node's built-in test runner, type stripping and `node:sqlite`.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'

import {
  DATABASE_FILENAME,
  DatabaseInitError,
  initializeDatabase,
  readDatabaseVersion,
  runMigrations,
} from '../electron/db/database.ts'
import { CURRENT_DATABASE_VERSION, DATABASE_MIGRATIONS } from '../electron/db/schema.ts'
import type { DatabaseMigration } from '../electron/db/schema.ts'

let root: string

before(() => {
  root = mkdtempSync(join(tmpdir(), 'x31desk-db-'))
})

after(() => {
  rmSync(root, { recursive: true, force: true })
})

function tableNames(database: DatabaseSync): string[] {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => String(row.name))
}

test('a fresh database is created and migrated to the current version', () => {
  const directory = join(root, 'fresh')
  const database = initializeDatabase(directory)

  try {
    assert.equal(database.filePath, join(directory, DATABASE_FILENAME))
    assert.equal(database.version, CURRENT_DATABASE_VERSION)

    const tables = tableNames(database.connection)

    for (const table of [
      'archive',
      'archive_corruption',
      'meta',
      'notes',
      'snippet_tags',
      'snippets',
      'tasks',
    ]) {
      assert.ok(tables.includes(table), `expected the ${table} table`)
    }
  } finally {
    database.close()
  }
})

test('opening an existing database is idempotent', () => {
  const directory = join(root, 'idempotent')

  initializeDatabase(directory).close()

  const database = initializeDatabase(directory)

  try {
    assert.equal(database.version, CURRENT_DATABASE_VERSION)
  } finally {
    database.close()
  }
})

test('durability and foreign-key settings are applied', () => {
  const database = initializeDatabase(join(root, 'pragmas'))

  try {
    assert.equal(database.connection.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal')
    // FULL is 2 in SQLite's `PRAGMA synchronous`.
    assert.equal(database.connection.prepare('PRAGMA synchronous').get()?.synchronous, 2)
    assert.equal(database.connection.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1)
  } finally {
    database.close()
  }
})

test('a database written by a newer build is refused rather than downgraded', () => {
  const directory = join(root, 'newer')
  const database = initializeDatabase(directory)

  database.connection.exec(`PRAGMA user_version = ${CURRENT_DATABASE_VERSION + 1}`)
  database.close()

  assert.throws(
    () => initializeDatabase(directory),
    (error) => error instanceof DatabaseInitError && error.code === 'newer-schema',
  )
})

test('a failed migration is rolled back and does not advance the version', () => {
  const database = new DatabaseSync(':memory:')

  const migrations: DatabaseMigration[] = [
    {
      version: 1,
      description: 'first',
      up: (connection) => connection.exec('CREATE TABLE first (id INTEGER)'),
    },
    {
      version: 2,
      description: 'second',
      up: (connection) => {
        connection.exec('CREATE TABLE second (id INTEGER)')
        throw new Error('boom')
      },
    },
  ]

  try {
    assert.throws(
      () => runMigrations(database, migrations),
      (error) => error instanceof DatabaseInitError && error.code === 'migration-failed',
    )

    assert.equal(readDatabaseVersion(database), 1)

    const tables = tableNames(database)
    assert.ok(tables.includes('first'))
    assert.ok(!tables.includes('second'), 'the failed step must be rolled back in full')
  } finally {
    database.close()
  }
})

test('a migration list that skips a version is rejected', () => {
  const database = new DatabaseSync(':memory:')

  try {
    assert.throws(() =>
      runMigrations(database, [
        { version: 1, description: 'first', up: () => {} },
        { version: 3, description: 'third', up: () => {} },
      ]),
    )
  } finally {
    database.close()
  }
})

test('an unusable database directory surfaces an explicit error', () => {
  const blocker = join(root, 'blocker')
  writeFileSync(blocker, 'not a directory')

  assert.throws(
    () => initializeDatabase(join(blocker, 'nested')),
    (error) => error instanceof DatabaseInitError && error.code === 'directory-unavailable',
  )
})

test('the shipped migration list is sequential and defines the current version', () => {
  assert.equal(CURRENT_DATABASE_VERSION, DATABASE_MIGRATIONS.length)

  DATABASE_MIGRATIONS.forEach((migration, index) => {
    assert.equal(migration.version, index + 1)
  })
})

test('an older database is upgraded in place, keeping its rows', () => {
  const directory = join(root, 'upgrade')

  mkdirSync(directory, { recursive: true })

  // Build a file that only knows version 1, then put a note in it — the shape a
  // database written by an earlier build of the application has.
  const legacy = new DatabaseSync(join(directory, DATABASE_FILENAME))

  try {
    runMigrations(legacy, DATABASE_MIGRATIONS.slice(0, 1))
    assert.equal(readDatabaseVersion(legacy), 1)

    legacy
      .prepare('INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('kept', 'Kept', 'Body', 1, 1)
  } finally {
    legacy.close()
  }

  const database = initializeDatabase(directory)

  try {
    assert.equal(database.version, CURRENT_DATABASE_VERSION)
    assert.ok(tableNames(database.connection).includes('archive_corruption'))

    const row = database.connection.prepare('SELECT title FROM notes WHERE id = ?').get('kept')
    assert.equal(row?.title, 'Kept')
  } finally {
    database.close()
  }
})

test('each step of a longer chain applies, and a later failure stops at the last completed version', () => {
  const database = new DatabaseSync(':memory:')

  const migrations: DatabaseMigration[] = [
    {
      version: 1,
      description: 'first',
      up: (connection) => connection.exec('CREATE TABLE first (id INTEGER)'),
    },
    {
      version: 2,
      description: 'second',
      up: (connection) => connection.exec('CREATE TABLE second (id INTEGER)'),
    },
    {
      version: 3,
      description: 'third',
      up: (connection) => {
        connection.exec('CREATE TABLE third (id INTEGER)')
        throw new Error('boom')
      },
    },
  ]

  try {
    assert.throws(
      () => runMigrations(database, migrations),
      (error) => error instanceof DatabaseInitError && error.code === 'migration-failed',
    )

    // The two completed steps stay; the failed third is rolled back in full.
    assert.equal(readDatabaseVersion(database), 2)

    const tables = tableNames(database)
    assert.ok(tables.includes('first'))
    assert.ok(tables.includes('second'))
    assert.ok(!tables.includes('third'), 'the failed step must be rolled back in full')
  } finally {
    database.close()
  }
})
