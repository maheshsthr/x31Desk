// Focused tests for cross-tab synchronization:
//   * `crossTabSync` — the key-filtered `storage`-event subscription, including
//     its guards for another storage area, a whole-storage clear and a browser
//     that exposes no event API at all.
//   * `taskStore` / `archiveStore` / `settingsStore` — that a change another tab
//     wrote is folded into the shared snapshot, and that the read does not
//     disturb newer local state or rebuild what did not move.
//
// Dependency-free: Node's built-in test runner and type stripping only.
//
// The "other tab" is simulated the way the browser behaves: another document
// writes to the shared `localStorage`, and this document receives a `storage`
// event. (A real tab never receives the event for its *own* write, which is what
// makes the mechanism loop-free — see `crossTabSync.ts`.)
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createArchiveStore } from '@/data/archiveStore'
import { createLocalArchiveRepository } from '@/data/archiveRepository'
import { subscribeToStorageKeys } from '@/data/crossTabSync'
import { createLocalNoteRepository } from '@/data/noteRepository'
import { createSettingsStore } from '@/data/settingsStore'
import { createLocalSnippetRepository } from '@/data/snippetRepository'
import { STORAGE_KEYS } from '@/data/storageKeys'
import { createLocalTaskRepository } from '@/data/taskRepository'
import { createTaskStore } from '@/data/taskStore'

// ---------------------------------------------------------------------------
// harness
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

/**
 * Installs a fake `window` exposing a shared `localStorage` and a `storage`
 * listener registry, and returns the pieces a test needs to play the "other
 * tab": mutating the storage, then delivering the event to this document.
 */
function installWindow(initial = {}) {
  const storage = createFakeStorage(initial)
  const listeners = new Set()

  const fakeWindow = {
    localStorage: storage,
    addEventListener(type, handler) {
      if (type === 'storage') {
        listeners.add(handler)
      }
    },
    removeEventListener(type, handler) {
      if (type === 'storage') {
        listeners.delete(handler)
      }
    },
    /** How many `storage` listeners this document currently holds. */
    storageListenerCount: () => listeners.size,
    /**
     * Delivers the `storage` event the browser would fire in *this* document
     * after another tab changed `key`.
     */
    deliverStorageEvent(key, { storageArea = storage } = {}) {
      const event = { key, oldValue: null, newValue: null, storageArea }
      for (const listener of [...listeners]) {
        listener(event)
      }
    },
  }

  globalThis.window = fakeWindow

  return { storage, fakeWindow }
}

/** Lets the repository microtasks and `readStable` settle. */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function makeTask(id, title = 'Task') {
  return {
    id,
    title,
    description: '',
    dueDate: null,
    priority: 'medium',
    completed: false,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
  }
}

function makeArchivedNote(id, archivedAt = 1) {
  return {
    type: 'note',
    archivedAt,
    note: { id, title: id, content: '', createdAt: 1, updatedAt: 1 },
  }
}

// ---------------------------------------------------------------------------
// the primitive
// ---------------------------------------------------------------------------

test('notifies a watcher when another tab changes a watched key', () => {
  const { fakeWindow } = installWindow()
  let calls = 0
  const unsubscribe = subscribeToStorageKeys([STORAGE_KEYS.notes], () => {
    calls += 1
  })

  fakeWindow.deliverStorageEvent(STORAGE_KEYS.notes)
  assert.equal(calls, 1)

  // Unsubscribing detaches for good; a second call is harmless.
  unsubscribe()
  unsubscribe()
  fakeWindow.deliverStorageEvent(STORAGE_KEYS.notes)
  assert.equal(calls, 1)
})

test('ignores a change to a key it is not watching', () => {
  const { fakeWindow } = installWindow()
  let calls = 0
  subscribeToStorageKeys([STORAGE_KEYS.notes], () => {
    calls += 1
  })

  fakeWindow.deliverStorageEvent(STORAGE_KEYS.tasks)
  assert.equal(calls, 0)
})

test('a whole-storage clear (a null key) reaches every watcher', () => {
  const { fakeWindow } = installWindow()
  let calls = 0
  subscribeToStorageKeys([STORAGE_KEYS.notes], () => {
    calls += 1
  })

  fakeWindow.deliverStorageEvent(null)
  assert.equal(calls, 1)
})

test('ignores a change made to a different storage area', () => {
  const { fakeWindow } = installWindow()
  let calls = 0
  subscribeToStorageKeys([STORAGE_KEYS.notes], () => {
    calls += 1
  })

  // A `sessionStorage` change shares the event shape but not the area.
  fakeWindow.deliverStorageEvent(STORAGE_KEYS.notes, { storageArea: {} })
  assert.equal(calls, 0)
})

test('subscribing degrades to a no-op without a window or a storage event API', () => {
  let calls = 0

  delete globalThis.window
  const withoutWindow = subscribeToStorageKeys([STORAGE_KEYS.notes], () => {
    calls += 1
  })
  assert.doesNotThrow(() => withoutWindow())

  // A window that has storage but no event API (a hardened environment).
  globalThis.window = { localStorage: createFakeStorage() }
  const withoutEventApi = subscribeToStorageKeys([STORAGE_KEYS.notes], () => {
    calls += 1
  })
  assert.doesNotThrow(() => withoutEventApi())

  assert.equal(calls, 0)
})

// ---------------------------------------------------------------------------
// taskStore
// ---------------------------------------------------------------------------

test('a task another tab created appears in the shared snapshot', async () => {
  const { storage, fakeWindow } = installWindow({ [STORAGE_KEYS.tasks]: '[]' })
  const store = createTaskStore(createLocalTaskRepository())
  store.subscribe(() => {})
  await tick()

  storage.setItem(STORAGE_KEYS.tasks, JSON.stringify([makeTask('t1', 'From another tab')]))
  fakeWindow.deliverStorageEvent(STORAGE_KEYS.tasks)
  await tick()

  assert.equal(store.getSnapshot().tasks.length, 1)
  assert.equal(store.getSnapshot().tasks[0].title, 'From another tab')
})

test('a task another tab deleted is dropped from the snapshot', async () => {
  const { storage, fakeWindow } = installWindow({
    [STORAGE_KEYS.tasks]: JSON.stringify([makeTask('t1'), makeTask('t2', 'Two')]),
  })
  const store = createTaskStore(createLocalTaskRepository())
  store.subscribe(() => {})
  await tick()
  assert.equal(store.getSnapshot().tasks.length, 2)

  storage.setItem(STORAGE_KEYS.tasks, JSON.stringify([makeTask('t1')]))
  fakeWindow.deliverStorageEvent(STORAGE_KEYS.tasks)
  await tick()

  assert.deepEqual(
    store.getSnapshot().tasks.map((task) => task.id),
    ['t1'],
  )
})

test('a change another tab made becomes the base for this tab’s next write', async () => {
  const { storage, fakeWindow } = installWindow({
    [STORAGE_KEYS.tasks]: JSON.stringify([makeTask('t1')]),
  })
  const store = createTaskStore(createLocalTaskRepository())
  store.subscribe(() => {})
  await tick()

  // Another tab adds a task while this tab sits idle (it read the existing
  // task, then wrote both back).
  storage.setItem(
    STORAGE_KEYS.tasks,
    JSON.stringify([makeTask('t1'), makeTask('t2', 'Other tab')]),
  )
  fakeWindow.deliverStorageEvent(STORAGE_KEYS.tasks)
  await tick()

  // This tab now writes: its read-modify-write starts from the refreshed base,
  // so the other tab's task is not lost from this tab's write.
  await store.createTask({ title: 'Mine', description: '', dueDate: null, priority: 'medium' })

  const stored = JSON.parse(storage.getItem(STORAGE_KEYS.tasks))
  assert.deepEqual(
    stored.map((task) => task.title).sort(),
    ['Mine', 'Other tab', 'Task'],
  )
})

test('a local write needs no event and opens no second watcher', async () => {
  const { fakeWindow } = installWindow({ [STORAGE_KEYS.tasks]: '[]' })
  const store = createTaskStore(createLocalTaskRepository())
  store.subscribe(() => {})
  await tick()

  await store.createTask({ title: 'Local', description: '', dueDate: null, priority: 'medium' })

  assert.equal(store.getSnapshot().tasks.length, 1)
  assert.equal(fakeWindow.storageListenerCount(), 1)
})

test('the watcher is attached only while the store has a subscriber', () => {
  const { fakeWindow } = installWindow()
  const store = createTaskStore(createLocalTaskRepository())

  const first = store.subscribe(() => {})
  const second = store.subscribe(() => {})
  assert.equal(fakeWindow.storageListenerCount(), 1)

  first()
  assert.equal(fakeWindow.storageListenerCount(), 1)

  second()
  assert.equal(fakeWindow.storageListenerCount(), 0)
})

// ---------------------------------------------------------------------------
// archiveStore
// ---------------------------------------------------------------------------

test('an item another tab archived appears in the archive snapshot', async () => {
  const { storage, fakeWindow } = installWindow({
    [STORAGE_KEYS.archive]: JSON.stringify([makeArchivedNote('n1')]),
  })

  const store = createArchiveStore({
    archive: createLocalArchiveRepository(),
    notes: createLocalNoteRepository(),
    snippets: createLocalSnippetRepository(),
    tasks: createTaskStore(createLocalTaskRepository()),
  })

  store.subscribe(() => {})
  await tick()
  assert.equal(store.getSnapshot().items.length, 1)

  storage.setItem(
    STORAGE_KEYS.archive,
    JSON.stringify([makeArchivedNote('n1'), makeArchivedNote('n2', 2)]),
  )
  fakeWindow.deliverStorageEvent(STORAGE_KEYS.archive)
  await tick()

  assert.equal(store.getSnapshot().items.length, 2)
})

// ---------------------------------------------------------------------------
// settingsStore
// ---------------------------------------------------------------------------

test('a theme another tab chose is applied here without rebuilding the editor', () => {
  const { storage, fakeWindow } = installWindow({ [STORAGE_KEYS.theme]: 'light' })
  const store = createSettingsStore()
  let calls = 0
  store.subscribe(() => {
    calls += 1
  })

  const editorBefore = store.getSnapshot().editor

  storage.setItem(STORAGE_KEYS.theme, 'dark')
  fakeWindow.deliverStorageEvent(STORAGE_KEYS.theme)

  const snapshot = store.getSnapshot()
  assert.equal(snapshot.themePreference, 'dark')
  assert.equal(snapshot.resolvedTheme, 'dark')
  assert.equal(calls, 1)
  // A theme-only change must keep the editor slice referentially stable.
  assert.equal(snapshot.editor, editorBefore)
})

test('an editor preference another tab changed is adopted', () => {
  const { storage, fakeWindow } = installWindow({ [STORAGE_KEYS.theme]: 'light' })
  const store = createSettingsStore()
  store.subscribe(() => {})

  const next = {
    fontSize: 18,
    fontWeight: 'medium',
    lineNumbers: false,
    activeLine: false,
    bracketMatching: false,
  }
  storage.setItem(STORAGE_KEYS.editor, JSON.stringify(next))
  fakeWindow.deliverStorageEvent(STORAGE_KEYS.editor)

  assert.deepEqual(store.getSnapshot().editor, next)
})

test('a redundant storage event with no actual change does not emit', () => {
  const { fakeWindow } = installWindow({ [STORAGE_KEYS.theme]: 'dark' })
  const store = createSettingsStore()
  let calls = 0
  store.subscribe(() => {
    calls += 1
  })

  // Another tab wrote the same value this store already holds.
  fakeWindow.deliverStorageEvent(STORAGE_KEYS.theme)

  assert.equal(calls, 0)
})
