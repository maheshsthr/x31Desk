// Archive display order.
// ---------------------------------------------------------------------------
// The archive list is ordered by `archivedAt` alone. Two records can share a
// timestamp — a bulk action, or a fast machine — so the tie-break matters: the
// sort is stable, and whatever order the backend handed the records over in for
// a tie is the order that gets rendered.
//
// That order is the same under either backend — the `localStorage` archive
// prepends and the SQLite archive orders `archived_at DESC, rowid DESC`, so both
// give newest-*added*-first for equal timestamps. The display-side contract is
// pinned here; the two backends actually agreeing on it is pinned by running
// them both in `repositoryConformance.test.ts`.
//
// Dependency-free: Node's built-in test runner and type stripping.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ArchivedItem } from '@/types/archive'
import type { Note } from '@/types/note'
import { selectArchivedItems } from '@/utils/archive'

function note(id: string, archivedAt: number): ArchivedItem {
  const record: Note = {
    id,
    title: id,
    content: id,
    createdAt: 0,
    updatedAt: 0,
  }

  return { type: 'note', archivedAt, note: record }
}

/** The ids in display order, so a test can read the result at a glance. */
function ids(items: readonly ArchivedItem[]): string[] {
  return selectArchivedItems(items, 'all', '').map((item) =>
    item.type === 'note' ? item.note.id : '?',
  )
}

test('orders strictly by archivedAt, newest first, whatever the input order', () => {
  const items = [note('middle', 200), note('oldest', 100), note('newest', 300)]

  assert.deepEqual(ids(items), ['newest', 'middle', 'oldest'])
})

test('breaks a timestamp tie by the order the backend handed the records over', () => {
  // Equal `archivedAt`: the stable sort must preserve the incoming order, which
  // is what lets both backends agree on newest-added-first for a tie. Whatever
  // order the backend delivered for the tie is the order that is rendered.
  const items = [note('added-second', 500), note('added-first', 500)]

  assert.deepEqual(ids(items), ['added-second', 'added-first'])

  // And the other way round: the same two records in the other order render in
  // that order — `selectArchivedItems` never re-sorts a tie itself.
  assert.deepEqual(ids([note('added-first', 500), note('added-second', 500)]), [
    'added-first',
    'added-second',
  ])
})

test('filtering does not disturb the order', () => {
  const items = [note('n1', 100), note('n2', 300), note('n3', 200)]

  assert.deepEqual(ids(items), ['n2', 'n3', 'n1'])
  assert.equal(selectArchivedItems(items, 'note', '').length, 3)
  // A filter that excludes everything yields an empty, not null, array.
  assert.deepEqual(selectArchivedItems(items, 'task', ''), [])
})

test('returns a fresh array, so a caller cannot mutate the source', () => {
  const items = [note('a', 100)]

  assert.notEqual(selectArchivedItems(items, 'all', ''), items)
})
