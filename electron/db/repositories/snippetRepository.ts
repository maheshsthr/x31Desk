/**
 * x31Desk — the SQLite-backed snippet repository.
 * ---------------------------------------------------------------------------
 * Implements the same `SnippetRepository` interface the `localStorage` adapter
 * does. Tags live in the `snippet_tags` child table keyed by
 * `(snippet_id, position)`, so their order is preserved exactly as the editor
 * produced it; every write replaces a snippet's tags wholesale, which is what
 * makes an edit that removes a tag actually remove it.
 *
 * The draft carries the tag field as raw comma-separated text — a tag may still
 * be half-typed — so it is parsed here, at the boundary, exactly as the
 * `localStorage` adapter parses it.
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import type { SnippetRepository } from '@/data/repositoryTypes'
import { DEFAULT_SNIPPET_LANGUAGE, isSnippetLanguage, type Snippet } from '@/types/snippet'
import { parseTags } from '@/utils/snippet'

import { asRow, asRows, readNumber, readString } from '../rows.ts'
import { runInTransaction } from '../transaction.ts'

const COLUMNS = 'id, title, code, language, created_at, updated_at'

/** Reads a language column, falling back to the default for an unknown value. */
function readLanguage(row: Record<string, unknown>): Snippet['language'] {
  const value = row.language

  return isSnippetLanguage(value) ? value : DEFAULT_SNIPPET_LANGUAGE
}

/**
 * Converts one `snippets` row and its already-ordered tags to a {@link Snippet}.
 *
 * Module scope rather than inside the factory — it closes over nothing — and
 * exported so the one-time `localStorage` import reads a row through the same
 * mapping the repository uses, rather than a second copy that could drift.
 */
export function toSnippet(row: Record<string, unknown>, tags: readonly string[]): Snippet {
  return {
    id: readString(row, 'id'),
    title: readString(row, 'title'),
    code: readString(row, 'code'),
    language: readLanguage(row),
    tags: [...tags],
    createdAt: readNumber(row, 'created_at'),
    updatedAt: readNumber(row, 'updated_at'),
  }
}

/**
 * The SQLite-backed snippets store.
 *
 * Every write touches two tables — the snippet row and its tags — so all of them
 * run in a transaction. Deletes also clear `snippet_tags` first rather than
 * relying on the foreign key's cascade, so the operation is correct even if the
 * connection was opened without foreign-key enforcement.
 */
export function createSqliteSnippetRepository(database: DatabaseSync): SnippetRepository {
  const selectAll = database.prepare(`SELECT ${COLUMNS} FROM snippets ORDER BY rowid`)
  const selectOne = database.prepare(`SELECT ${COLUMNS} FROM snippets WHERE id = ?`)
  const selectTags = database.prepare(
    'SELECT snippet_id, tag FROM snippet_tags ORDER BY snippet_id, position',
  )
  const selectTagsFor = database.prepare(
    'SELECT tag FROM snippet_tags WHERE snippet_id = ? ORDER BY position',
  )
  const upsert = database.prepare(`
    INSERT INTO snippets (id, title, code, language, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      code = excluded.code,
      language = excluded.language,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `)
  const updateOne = database.prepare(
    'UPDATE snippets SET title = ?, code = ?, language = ?, updated_at = ? WHERE id = ?',
  )
  const deleteTagsFor = database.prepare('DELETE FROM snippet_tags WHERE snippet_id = ?')
  const insertTag = database.prepare(
    'INSERT INTO snippet_tags (snippet_id, position, tag) VALUES (?, ?, ?)',
  )
  const deleteOne = database.prepare('DELETE FROM snippets WHERE id = ?')
  const deleteAllTags = database.prepare('DELETE FROM snippet_tags')
  const deleteAll = database.prepare('DELETE FROM snippets')

  function readTags(id: string): string[] {
    return asRows(selectTagsFor.all(id)).map((row) => readString(row, 'tag'))
  }

  function writeTags(id: string, tags: readonly string[]): void {
    deleteTagsFor.run(id)

    tags.forEach((tag, position) => {
      insertTag.run(id, position, tag)
    })
  }

  function readOne(id: string): Snippet | null {
    const row = asRow(selectOne.get(id))

    return row === null ? null : toSnippet(row, readTags(id))
  }

  return {
    async list() {
      const tagsBySnippet = new Map<string, string[]>()

      for (const row of asRows(selectTags.all())) {
        const id = readString(row, 'snippet_id')
        const tags = tagsBySnippet.get(id) ?? []

        tags.push(readString(row, 'tag'))
        tagsBySnippet.set(id, tags)
      }

      return asRows(selectAll.all()).map((row) =>
        toSnippet(row, tagsBySnippet.get(readString(row, 'id')) ?? []),
      )
    },

    async create(draft) {
      const now = Date.now()
      const snippet: Snippet = {
        id: randomUUID(),
        title: draft.title,
        code: draft.code,
        language: draft.language,
        tags: parseTags(draft.tags),
        createdAt: now,
        updatedAt: now,
      }

      return runInTransaction(database, () => {
        upsert.run(
          snippet.id,
          snippet.title,
          snippet.code,
          snippet.language,
          snippet.createdAt,
          snippet.updatedAt,
        )
        writeTags(snippet.id, snippet.tags)

        return snippet
      })
    },

    async update(id, draft) {
      return runInTransaction(database, () => {
        const existing = readOne(id)

        if (existing === null) {
          return null
        }

        const updatedAt = Date.now()
        const tags = parseTags(draft.tags)

        updateOne.run(draft.title, draft.code, draft.language, updatedAt, id)
        writeTags(id, tags)

        return {
          ...existing,
          title: draft.title,
          code: draft.code,
          language: draft.language,
          tags,
          updatedAt,
        }
      })
    },

    async insert(snippet) {
      return runInTransaction(database, () => {
        upsert.run(
          snippet.id,
          snippet.title,
          snippet.code,
          snippet.language,
          snippet.createdAt,
          snippet.updatedAt,
        )
        writeTags(snippet.id, snippet.tags)

        return snippet
      })
    },

    async remove(id) {
      runInTransaction(database, () => {
        deleteTagsFor.run(id)
        deleteOne.run(id)
      })
    },

    async clear() {
      runInTransaction(database, () => {
        deleteAllTags.run()
        deleteAll.run()
      })
    },
  }
}
