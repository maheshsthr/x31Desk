// Focused tests for storage-failure reporting:
//   * `storageError` — classification of the browser's own signals, the
//     remembered "last failure" a boolean-returning store leans on, and the
//     user-facing wording.
//   * `noteRepository` — that its writes, reads and clears actually record and
//     tag a failure through the shared helper.
//
// Dependency-free: Node's built-in test runner and type stripping only.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createLocalNoteRepository } from '@/data/noteRepository'
import {
  asStorageError,
  classifyStorageError,
  getLastStorageErrorKind,
  resetLastStorageErrorKind,
  runStorageOperation,
  runStorageRead,
  StorageError,
  storageErrorMessage,
  storageErrorSummary,
} from '@/data/storageError'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Storage whose failing operations can be aimed at one method, so a test can
 * make a single write fail without also disabling reads.
 */
function makeStorage({ onGetItem, onSetItem, onRemoveItem } = {}) {
  const map = new Map()

  return {
    getItem(key) {
      onGetItem?.()
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      onSetItem?.(key, value)
      map.set(key, String(value))
    },
    removeItem(key) {
      onRemoveItem?.()
      map.delete(key)
    },
    clear() {
      map.clear()
    },
    key: () => null,
    get length() {
      return map.size
    },
    dump: () => Object.fromEntries(map),
  }
}

function installStorage(options) {
  const storage = makeStorage(options)
  globalThis.window = { localStorage: storage }
  return storage
}

const quota = () => new DOMException('full', 'QuotaExceededError')
const blocked = () => new DOMException('blocked', 'SecurityError')

// ---------------------------------------------------------------------------
// classification
// ---------------------------------------------------------------------------

test('a quota failure is recognised by its name', () => {
  assert.equal(classifyStorageError(new DOMException('full', 'QuotaExceededError')), 'quota')
})

test('legacy quota names and codes are recognised too', () => {
  assert.equal(classifyStorageError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), 'quota')
  assert.equal(classifyStorageError({ code: 22 }), 'quota')
  assert.equal(classifyStorageError({ code: 1014 }), 'quota')
})

test('a blocked or disabled storage is reported as unavailable', () => {
  assert.equal(classifyStorageError(new DOMException('blocked', 'SecurityError')), 'unavailable')
  assert.equal(classifyStorageError({ code: 18 }), 'unavailable')
})

test('anything that cannot be classified confidently is unknown', () => {
  assert.equal(classifyStorageError(new Error('boom')), 'unknown')
  assert.equal(classifyStorageError('boom'), 'unknown')
  assert.equal(classifyStorageError(null), 'unknown')
  assert.equal(classifyStorageError(undefined), 'unknown')
  assert.equal(classifyStorageError({ code: 999 }), 'unknown')
})

test('an already-tagged error keeps its kind', () => {
  assert.equal(classifyStorageError(new StorageError('quota')), 'quota')
  assert.equal(classifyStorageError(new StorageError('unavailable')), 'unavailable')
})

test('asStorageError wraps a raw failure and preserves it as the cause', () => {
  const raw = quota()
  const wrapped = asStorageError(raw)

  assert.ok(wrapped instanceof StorageError)
  assert.equal(wrapped.kind, 'quota')
  assert.equal(wrapped.cause, raw)

  // Wrapping twice does not nest.
  assert.equal(asStorageError(wrapped), wrapped)
})

// ---------------------------------------------------------------------------
// remembered failure
// ---------------------------------------------------------------------------

test('a successful operation returns its value and forgets an earlier failure', () => {
  resetLastStorageErrorKind()
  assert.throws(() =>
    runStorageOperation(() => {
      throw quota()
    }),
  )
  assert.equal(getLastStorageErrorKind(), 'quota')

  const value = runStorageOperation(() => 'ok')

  assert.equal(value, 'ok')
  assert.equal(getLastStorageErrorKind(), null)
})

test('a failing operation is tagged, remembered and rethrown', () => {
  resetLastStorageErrorKind()

  assert.throws(
    () =>
      runStorageOperation(() => {
        throw blocked()
      }),
    (error) => error instanceof StorageError && error.kind === 'unavailable',
  )

  assert.equal(getLastStorageErrorKind(), 'unavailable')
})

test('a read returns its value on success and its fallback on failure', () => {
  resetLastStorageErrorKind()

  assert.equal(runStorageRead(() => 'value', 'fallback'), 'value')
  assert.equal(getLastStorageErrorKind(), null)

  const fallback = runStorageRead(() => {
    throw blocked()
  }, 'fallback')

  assert.equal(fallback, 'fallback')
  assert.equal(getLastStorageErrorKind(), 'unavailable')
})

// ---------------------------------------------------------------------------
// repository wiring
// ---------------------------------------------------------------------------

test('a failing write rejects with a tagged error and records the kind', async () => {
  resetLastStorageErrorKind()
  installStorage({
    onSetItem: () => {
      throw quota()
    },
  })

  const repository = createLocalNoteRepository()

  await assert.rejects(
    () => repository.create(),
    (error) => error instanceof StorageError && error.kind === 'quota',
  )
  assert.equal(getLastStorageErrorKind(), 'quota')
})

test('a later successful write forgets the earlier failure', async () => {
  resetLastStorageErrorKind()

  let full = true
  installStorage({
    onSetItem: () => {
      if (full) {
        throw quota()
      }
    },
  })

  const repository = createLocalNoteRepository()

  await assert.rejects(() => repository.create())
  assert.equal(getLastStorageErrorKind(), 'quota')

  full = false
  await repository.create()

  assert.equal(getLastStorageErrorKind(), null)
})

test('a failing clear is tagged as unavailable', async () => {
  resetLastStorageErrorKind()
  installStorage({
    onRemoveItem: () => {
      throw blocked()
    },
  })

  const repository = createLocalNoteRepository()

  await assert.rejects(
    () => repository.clear(),
    (error) => error instanceof StorageError && error.kind === 'unavailable',
  )
  assert.equal(getLastStorageErrorKind(), 'unavailable')
})

test('disabled storage reads as empty and writes report unavailable', async () => {
  resetLastStorageErrorKind()
  installStorage({
    onGetItem: () => {
      throw blocked()
    },
    onSetItem: () => {
      throw blocked()
    },
  })

  const repository = createLocalNoteRepository()

  // The workspace still opens, empty, rather than failing.
  assert.deepEqual(await repository.list(), [])
  assert.equal(getLastStorageErrorKind(), 'unavailable')

  await assert.rejects(() => repository.create(), (error) => {
    return classifyStorageError(error) === 'unavailable'
  })
})

test('a read of a still-present collection clears an earlier failure', async () => {
  resetLastStorageErrorKind()

  let full = true
  installStorage({
    onSetItem: () => {
      if (full) {
        throw quota()
      }
    },
  })

  const repository = createLocalNoteRepository()

  await assert.rejects(() => repository.create())
  assert.equal(getLastStorageErrorKind(), 'quota')

  // A later read succeeds, so the remembered failure no longer applies.
  await repository.list()
  assert.equal(getLastStorageErrorKind(), null)
})

// ---------------------------------------------------------------------------
// wording
// ---------------------------------------------------------------------------

test('storageErrorMessage is actionable for classified failures and generic otherwise', () => {
  assert.match(storageErrorMessage('quota', 'fallback'), /full/i)
  assert.match(storageErrorMessage('quota', 'fallback'), /not saved|nothing could be saved/i)
  assert.match(storageErrorMessage('unavailable', 'fallback'), /unavailable/i)
  assert.equal(storageErrorMessage('unknown', 'fallback'), 'fallback')
  assert.equal(storageErrorMessage(null, 'fallback'), 'fallback')
})

test('storageErrorSummary is terse and empty for anything unknown', () => {
  assert.equal(storageErrorSummary('quota'), 'storage full')
  assert.equal(storageErrorSummary('unavailable'), 'storage unavailable')
  assert.equal(storageErrorSummary('unknown'), null)
  assert.equal(storageErrorSummary(null), null)
})
