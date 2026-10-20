/**
 * x31Desk — SQLite schema history.
 * ---------------------------------------------------------------------------
 * The database is versioned with SQLite's own `PRAGMA user_version`, which is
 * an integer stored in the database header and participates in transactions.
 * This module is the only place the structure is described: an ordered,
 * forward-only list of migrations, each of which moves the database from one
 * version to the next. `database.ts` applies them and is the only thing that
 * writes `user_version`, and only after a step's statements have succeeded.
 *
 * This is deliberately *not* the same version as the renderer's `x31desk:schema`
 * marker. That marker describes the shape of the records in `localStorage`;
 * this one describes the structure of the SQLite file. They move independently,
 * and neither rewrites the other.
 *
 * Version 1 is the approved initial schema: the four workspace collections plus
 * the child tables and metadata the plan settled on. No table is added ahead of
 * a feature that needs it — a later release appends a migration rather than
 * editing this one.
 */

import type { DatabaseSync } from 'node:sqlite'

/** One step in the database's structural history. */
export type DatabaseMigration = {
  /** The version this step produces. Migrations run in ascending order. */
  readonly version: number
  /** A short human label, used in the error message if the step fails. */
  readonly description: string
  /**
   * Applies the step. It runs inside a transaction opened by the runner, so it
   * must not begin or commit one itself; throwing rolls the whole step back.
   */
  readonly up: (database: DatabaseSync) => void
}

/**
 * The ordered, forward-only migration chain.
 *
 * Versions must be sequential from `1`; the runner refuses a list that skips or
 * repeats one, because a gap would silently mis-describe the on-disk version.
 */
export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    description: 'workspace collections',
    up(database) {
      database.exec(`
        CREATE TABLE notes (
          id         TEXT    PRIMARY KEY NOT NULL,
          title      TEXT    NOT NULL,
          content    TEXT    NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE tasks (
          id           TEXT    PRIMARY KEY NOT NULL,
          title        TEXT    NOT NULL,
          description  TEXT    NOT NULL,
          due_date     TEXT    CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          priority     TEXT    NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
          completed    INTEGER NOT NULL CHECK (completed IN (0, 1)),
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL,
          completed_at INTEGER
        );

        CREATE TABLE snippets (
          id         TEXT    PRIMARY KEY NOT NULL,
          title      TEXT    NOT NULL,
          code       TEXT    NOT NULL,
          language   TEXT    NOT NULL CHECK (language IN (
            'javascript', 'typescript', 'html', 'css', 'python', 'java',
            'php', 'sql', 'json', 'bash', 'plaintext'
          )),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE snippet_tags (
          snippet_id TEXT    NOT NULL REFERENCES snippets(id) ON DELETE CASCADE,
          position   INTEGER NOT NULL,
          tag        TEXT    NOT NULL,
          PRIMARY KEY (snippet_id, position)
        );

        CREATE TABLE archive (
          type        TEXT    NOT NULL CHECK (type IN ('note', 'task', 'snippet')),
          record_id   TEXT    NOT NULL,
          archived_at INTEGER NOT NULL,
          data        TEXT    NOT NULL,
          PRIMARY KEY (type, record_id)
        );

        CREATE TABLE meta (
          key   TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
      `)
    },
  },

  {
    version: 2,
    description: 'archive corruption vault',
    up(database) {
      // Where an `archive` row the adapter cannot read back is preserved,
      // write-once, before it is skipped. Mirrors the `localStorage` readers'
      // `x31desk:archive:unreadable` key: the raw `data` bytes are kept verbatim
      // beside enough identity to say which record they belonged to. It is a
      // separate table so a later legitimate write for the same `(type,
      // record_id)` cannot overwrite the preserved bytes, and so the live
      // archive is never rewritten to make room for them.
      //
      // `archived_at` is deliberately nullable here: it carries whatever the
      // malformed row held, which is identification metadata, not a constraint
      // the vault needs to enforce.
      database.exec(`
        CREATE TABLE archive_corruption (
          type        TEXT    NOT NULL,
          record_id   TEXT    NOT NULL,
          archived_at INTEGER,
          data        TEXT    NOT NULL,
          detected_at INTEGER NOT NULL,
          PRIMARY KEY (type, record_id)
        );
      `)
    },
  },
]

/**
 * The database structure version this build writes.
 *
 * Derived from the chain rather than written by hand, so the two cannot drift:
 * adding a migration is the only way to raise it.
 */
export const CURRENT_DATABASE_VERSION =
  DATABASE_MIGRATIONS[DATABASE_MIGRATIONS.length - 1]?.version ?? 0
