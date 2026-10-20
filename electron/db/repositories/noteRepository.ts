/**
 * x31Desk — the SQLite-backed note repository.
 * ---------------------------------------------------------------------------
 * Implements the same `NoteRepository` interface the `localStorage` adapter
 * does, so the application can be pointed at either without knowing which. The
 * connection is owned by the main process; this adapter only prepares statements
 * against it and never lets the path or any SQL cross the IPC boundary.
 *
 * Reads order by `rowid`, the insertion order, because ordering is a
 * presentation concern the UI applies itself and a stable base order keeps the
 * list from reshuffling between loads.
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import type { NoteRepository } from '@/data/repositoryTypes'
import type { Note } from '@/types/note'

import { asRow, asRows, readNumber, readString } from '../rows.ts'
import { runInTransaction } from '../transaction.ts'

const COLUMNS = 'id, title, content, created_at, updated_at'

/**
 * Converts one `notes` row to a {@link Note}.
 *
 * Exported so the one-time `localStorage` import reads a row through the same
 * mapping the repository uses, rather than a second copy that could drift.
 */
export function toNote(row: Record<string, unknown>): Note {
  return {
    id: readString(row, 'id'),
    title: readString(row, 'title'),
    content: readString(row, 'content'),
    createdAt: readNumber(row, 'created_at'),
    updatedAt: readNumber(row, 'updated_at'),
  }
}

/**
 * The SQLite-backed notes store.
 *
 * Statements are prepared once and reused, so a hot list or update does not
 * re-parse its SQL on every call. `update` and `insert` run in a transaction
 * because they read the row they are about to change; the rest are single
 * statements SQLite commits atomically on its own.
 */
export function createSqliteNoteRepository(database: DatabaseSync): NoteRepository {
  const selectAll = database.prepare(`SELECT ${COLUMNS} FROM notes ORDER BY rowid`)
  const selectOne = database.prepare(`SELECT ${COLUMNS} FROM notes WHERE id = ?`)
  const upsert = database.prepare(`
    INSERT INTO notes (id, title, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `)
  const updateOne = database.prepare(
    'UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?',
  )
  const deleteOne = database.prepare('DELETE FROM notes WHERE id = ?')
  const deleteAll = database.prepare('DELETE FROM notes')

  function readOne(id: string): Note | null {
    const row = asRow(selectOne.get(id))

    return row === null ? null : toNote(row)
  }

  return {
    async list() {
      return asRows(selectAll.all()).map(toNote)
    },

    async create() {
      const now = Date.now()
      const note: Note = {
        id: randomUUID(),
        title: '',
        content: '',
        createdAt: now,
        updatedAt: now,
      }

      upsert.run(note.id, note.title, note.content, note.createdAt, note.updatedAt)

      return note
    },

    async update(id, draft) {
      return runInTransaction(database, () => {
        const existing = readOne(id)

        if (existing === null) {
          return null
        }

        const updatedAt = Date.now()
        updateOne.run(draft.title, draft.content, updatedAt, id)

        return { ...existing, title: draft.title, content: draft.content, updatedAt }
      })
    },

    async insert(note) {
      upsert.run(note.id, note.title, note.content, note.createdAt, note.updatedAt)

      return note
    },

    async remove(id) {
      deleteOne.run(id)
    },

    async clear() {
      deleteAll.run()
    },
  }
}
