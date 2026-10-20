// Backup and restore, renderer half.
// ---------------------------------------------------------------------------
// The main process owns the database and the file dialogs; the renderer owns the
// Settings page, the preference read/write into `localStorage` and the decisions
// the user makes between the picker and the write. These tests pin that half
// with an in-memory fake `localStorage`, a fake save queue and a fake bridge, so
// what is exercised is exactly the conversation the renderer has over IPC:
//
//   * preferences are read per-key and a missing or unusable one simply does not
//     contribute, so a backup taken before a setting existed cannot reset it;
//   * restoring preferences reports whether anything *changed*, so "restored" is
//     never claimed for a write that left every value as it was;
//   * an export flushes pending saves first and refuses to write rather than
//     silently omitting an edit that has not reached the database;
//   * a merge that wrote nothing is reported as such and does not reload the
//     window, while a replace and any real change do;
//   * a bridge that rejects becomes a typed failure, never a thrown error.
//
// Dependency-free: Node's built-in test runner and type stripping.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, test } from 'node:test'

import {
  applyBackupPreferences,
  describeCounts,
  readBackupPreferences,
  runBackupExport,
  runBackupImport,
  runBackupInspect,
  totalRecords,
} from '@/data/backup'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupApplyOutcome,
  type BackupDocument,
  type BackupPreferences,
} from '@/data/ipc/contract'
import type { SaveQueue } from '@/data/saveQueue'
import { STORAGE_KEYS } from '@/data/storageKeys'
import type { DesktopBackupBridge } from '@/types/desktop'
import type { EditorPreferences } from '@/types/editorPreferences'
import type { ThemePreference } from '@/types/theme'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type FakeStorage = Storage & { readonly dump: () => Record<string, string> }

function createFakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const map = new Map(Object.entries(initial))

  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, String(value))
    },
    removeItem: (key) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
    dump: () => Object.fromEntries(map),
  }
}

/** A queue whose only observable behaviour is how `flushAll` settles. */
function fakeQueue(flushAll: () => Promise<void>): SaveQueue {
  return { flushAll } as unknown as SaveQueue
}

const EDITOR: EditorPreferences = {
  fontSize: 14,
  fontWeight: 'semibold',
  lineNumbers: false,
  activeLine: true,
  bracketMatching: false,
}

const DOCUMENT: BackupDocument = {
  format: BACKUP_FORMAT,
  formatVersion: BACKUP_FORMAT_VERSION,
  appVersion: '1.2.3',
  databaseVersion: 2,
  exportedAt: '2026-10-19T10:00:00.000Z',
  counts: { notes: 1, tasks: 1, snippets: 0, archive: 0 },
  notes: [{ id: 'n1', title: 'Note', content: 'Body', createdAt: 1, updatedAt: 2 }],
  tasks: [],
  snippets: [],
  archive: [],
}

/** A bridge whose three calls each have a default and can be overridden. */
function fakeBridge(overrides: Partial<DesktopBackupBridge> = {}): DesktopBackupBridge {
  return {
    create: async () => ({ outcome: 'cancelled' }),
    inspect: async () => ({ outcome: 'cancelled' }),
    apply: async () => ({ outcome: 'rejected', reason: 'malformed', message: 'nope' }),
    ...overrides,
  }
}

/** The applied outcome every "successful import" test starts from. */
type AppliedOutcome = Extract<BackupApplyOutcome, { outcome: 'applied' }>

function applied(overrides: Partial<AppliedOutcome> = {}): AppliedOutcome {
  return {
    outcome: 'applied',
    mode: 'merge',
    counts: { notes: 1, tasks: 0, snippets: 0, archive: 0 },
    unchanged: { notes: 0, tasks: 0, snippets: 0, archive: 0 },
    conflicts: [],
    preferences: null,
    ...overrides,
  }
}

beforeEach(() => {
  globalThis.window = { localStorage: createFakeStorage() } as unknown as Window & typeof globalThis
})

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

// ---------------------------------------------------------------------------
// counting helpers
// ---------------------------------------------------------------------------

test('totalRecords sums the four collections', () => {
  assert.equal(totalRecords({ notes: 2, tasks: 3, snippets: 4, archive: 5 }), 14)
  assert.equal(totalRecords({ notes: 0, tasks: 0, snippets: 0, archive: 0 }), 0)
})

test('describeCounts names only the collections that hold something', () => {
  assert.equal(describeCounts({ notes: 1, tasks: 0, snippets: 0, archive: 0 }), '1 note')
  assert.equal(
    describeCounts({ notes: 2, tasks: 3, snippets: 0, archive: 5 }),
    '2 notes, 3 tasks and 5 archived items',
  )
  assert.equal(
    describeCounts({ notes: 0, tasks: 1, snippets: 1, archive: 0 }),
    '1 task and 1 snippet',
  )
  assert.equal(describeCounts({ notes: 0, tasks: 0, snippets: 0, archive: 0 }), 'nothing')
})

// ---------------------------------------------------------------------------
// reading preferences
// ---------------------------------------------------------------------------

test('an empty workspace contributes no preferences at all', () => {
  assert.equal(readBackupPreferences(createFakeStorage()), null)
})

test('each stored preference is read independently', () => {
  assert.deepEqual(
    readBackupPreferences(createFakeStorage({ [STORAGE_KEYS.theme]: 'dark' })),
    { theme: 'dark' },
  )

  assert.deepEqual(
    readBackupPreferences(createFakeStorage({ [STORAGE_KEYS.editor]: JSON.stringify(EDITOR) })),
    { editor: EDITOR },
  )

  assert.deepEqual(
    readBackupPreferences(
      createFakeStorage({
        [STORAGE_KEYS.theme]: 'system',
        [STORAGE_KEYS.editor]: JSON.stringify(EDITOR),
      }),
    ),
    { theme: 'system', editor: EDITOR },
  )
})

test('a key left behind by a retired setting is not read back into a new backup', () => {
  // `x31desk:ui-scale` is written by versions that shipped a UI Scale setting.
  // It is no longer a preference, so an export must not carry it forward — but
  // it is also inert: it neither contributes nor prevents the real ones.
  const storage = createFakeStorage({
    'x31desk:ui-scale': JSON.stringify({ kind: 'preset', percent: 150 }),
  })

  assert.equal(readBackupPreferences(storage), null)

  assert.deepEqual(
    readBackupPreferences(
      createFakeStorage({
        'x31desk:ui-scale': JSON.stringify({ kind: 'preset', percent: 150 }),
        [STORAGE_KEYS.theme]: 'dark',
      }),
    ),
    { theme: 'dark' },
  )
})

test('an unusable preference is dropped rather than defaulted', () => {
  // A theme the app does not recognise contributes nothing — it must not become
  // "system" and quietly overwrite the user's real choice on restore.
  assert.equal(readBackupPreferences(createFakeStorage({ [STORAGE_KEYS.theme]: 'blue' })), null)

  // Key present but not JSON at all.
  assert.equal(readBackupPreferences(createFakeStorage({ [STORAGE_KEYS.editor]: '{oops' })), null)

  // Keys present but holding nothing.
  assert.equal(
    readBackupPreferences(
      createFakeStorage({ [STORAGE_KEYS.theme]: '', [STORAGE_KEYS.editor]: '' }),
    ),
    null,
  )
})

test('a partly readable editor preference is salvaged, not discarded', () => {
  const preferences = readBackupPreferences(
    createFakeStorage({ [STORAGE_KEYS.editor]: JSON.stringify({ fontSize: 999 }) }),
  )

  assert.ok(preferences?.editor)
  // The out-of-range size falls back; the missing fields take their defaults.
  assert.equal(preferences.editor.fontSize, 12)
  assert.equal(preferences.editor.fontWeight, 'medium')
  assert.equal(preferences.editor.lineNumbers, true)
})

test('a storage that throws contributes no preferences and does not throw', () => {
  const hostile = {
    getItem: () => {
      throw new Error('blocked')
    },
  } as unknown as Storage

  assert.equal(readBackupPreferences(hostile), null)
})

// ---------------------------------------------------------------------------
// applying preferences
// ---------------------------------------------------------------------------

test('applying nothing reports no change', () => {
  const storage = createFakeStorage()

  assert.equal(applyBackupPreferences(null, storage), false)
  assert.deepEqual(storage.dump(), {})
})

test('restoring preferences writes each key and reports the change', () => {
  const storage = createFakeStorage()

  const changed = applyBackupPreferences({ theme: 'dark', editor: EDITOR }, storage)

  assert.equal(changed, true)
  assert.deepEqual(storage.dump(), {
    [STORAGE_KEYS.theme]: 'dark',
    [STORAGE_KEYS.editor]: JSON.stringify(EDITOR),
  })
})

test('restoring the same values again reports no change', () => {
  const storage = createFakeStorage()

  assert.equal(applyBackupPreferences({ theme: 'dark' }, storage), true)
  assert.equal(applyBackupPreferences({ theme: 'dark' }, storage), false)
})

test('a preference the backup does not carry is left alone', () => {
  const storage = createFakeStorage({
    [STORAGE_KEYS.editor]: JSON.stringify(EDITOR),
  })

  assert.equal(applyBackupPreferences({ theme: 'dark' }, storage), true)

  // The key the document did not mention is untouched.
  assert.equal(storage.getItem(STORAGE_KEYS.editor), JSON.stringify(EDITOR))
})

test('an unknown theme is refused rather than written', () => {
  const storage = createFakeStorage()

  const changed = applyBackupPreferences(
    { theme: 'chartreuse' as unknown as ThemePreference },
    storage,
  )

  assert.equal(changed, false)
  assert.deepEqual(storage.dump(), {})
})

test('a preference key this build retired is never written back', () => {
  // The main process drops an unknown preference key before it ever crosses the
  // boundary, so the shape reaching the renderer cannot normally hold one. The
  // renderer still refuses to act on it, so a stale document cannot resurrect a
  // setting the application no longer has.
  const storage = createFakeStorage()

  const changed = applyBackupPreferences(
    { theme: 'dark', uiScale: { kind: 'preset', percent: 150 } } as unknown as BackupPreferences,
    storage,
  )

  assert.equal(changed, true)
  assert.deepEqual(storage.dump(), { [STORAGE_KEYS.theme]: 'dark' })
})

test('a storage that refuses the write reports no change instead of throwing', () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota')
    },
  } as unknown as Storage

  assert.equal(applyBackupPreferences({ theme: 'dark' }, storage), false)
})

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

test('an export without the desktop bridge is unsupported', async () => {
  assert.deepEqual(await runBackupExport({ queue: fakeQueue(async () => {}) }), {
    kind: 'unsupported',
  })
})

test('an export flushes pending saves before it asks the main process', async () => {
  const order: string[] = []

  const report = await runBackupExport({
    bridge: fakeBridge({
      create: async (request) => {
        order.push('create')
        assert.deepEqual(request, { preferences: undefined })
        return {
          outcome: 'written',
          path: 'C:/x/x31Desk-backup-2026-10-19.x31backup',
          fileName: 'x31Desk-backup-2026-10-19.x31backup',
          counts: { notes: 1, tasks: 0, snippets: 0, archive: 0 },
          bytes: 42,
          unreadableArchiveRows: 0,
          preferencesIncluded: false,
        }
      },
    }),
    queue: fakeQueue(async () => {
      order.push('flush')
    }),
  })

  assert.deepEqual(order, ['flush', 'create'])
  assert.deepEqual(report, {
    kind: 'written',
    fileName: 'x31Desk-backup-2026-10-19.x31backup',
    counts: { notes: 1, tasks: 0, snippets: 0, archive: 0 },
    unreadableArchiveRows: 0,
    preferencesIncluded: false,
  })
})

test('an export carries the preferences it read from storage', async () => {
  let captured: { readonly preferences?: BackupPreferences } | null = null

  await runBackupExport({
    bridge: fakeBridge({
      create: async (request) => {
        captured = request
        return { outcome: 'cancelled' }
      },
    }),
    storage: createFakeStorage({ [STORAGE_KEYS.theme]: 'dark' }),
    queue: fakeQueue(async () => {}),
  })

  assert.deepEqual(captured, { preferences: { theme: 'dark' } })
})

test('an export whose flush fails writes nothing at all', async () => {
  let asked = false

  const report = await runBackupExport({
    bridge: fakeBridge({
      create: async () => {
        asked = true
        return { outcome: 'cancelled' }
      },
    }),
    queue: fakeQueue(async () => {
      throw new Error('a save failed')
    }),
  })

  assert.equal(asked, false)
  assert.equal(report.kind, 'failed')
})

test('a cancelled export and a refused one are told apart', async () => {
  assert.deepEqual(
    await runBackupExport({
      bridge: fakeBridge({ create: async () => ({ outcome: 'cancelled' }) }),
      queue: fakeQueue(async () => {}),
    }),
    { kind: 'cancelled' },
  )

  const failed = await runBackupExport({
    bridge: fakeBridge({ create: async () => ({ outcome: 'failed', kind: 'unavailable' }) }),
    queue: fakeQueue(async () => {}),
  })

  assert.equal(failed.kind, 'failed')
})

test('a bridge that rejects during an export becomes a typed failure', async () => {
  const report = await runBackupExport({
    bridge: fakeBridge({
      create: async () => {
        throw new Error('ipc exploded')
      },
    }),
    queue: fakeQueue(async () => {}),
  })

  assert.equal(report.kind, 'failed')
})

test('unreadable archive rows are carried through so the page can explain them', async () => {
  const report = await runBackupExport({
    bridge: fakeBridge({
      create: async () => ({
        outcome: 'written',
        path: 'C:/x/x31Desk-backup-2026-10-19.x31backup',
        fileName: 'x31Desk-backup-2026-10-19.x31backup',
        counts: { notes: 0, tasks: 0, snippets: 0, archive: 2 },
        bytes: 10,
        unreadableArchiveRows: 1,
        preferencesIncluded: true,
      }),
    }),
    queue: fakeQueue(async () => {}),
  })

  assert.equal(report.kind, 'written')

  if (report.kind === 'written') {
    assert.equal(report.unreadableArchiveRows, 1)
    assert.equal(report.preferencesIncluded, true)
  }
})

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------

test('inspect reports unsupported without a bridge and cancellation unchanged', async () => {
  assert.deepEqual(await runBackupInspect(), { kind: 'unsupported' })

  assert.deepEqual(
    await runBackupInspect({ bridge: fakeBridge({ inspect: async () => ({ outcome: 'cancelled' }) }) }),
    { kind: 'cancelled' },
  )
})

test('an inspected file comes back with its preview and document intact', async () => {
  const preview = {
    appVersion: '1.2.3',
    exportedAt: '2026-10-19T10:00:00.000Z',
    counts: { notes: 1, tasks: 1, snippets: 0, archive: 0 },
    hasPreferences: true,
  }

  const report = await runBackupInspect({
    bridge: fakeBridge({
      inspect: async () => ({
        outcome: 'ready',
        fileName: 'my-backup.x31backup',
        preview,
        document: DOCUMENT,
      }),
    }),
  })

  assert.equal(report.kind, 'ready')

  if (report.kind === 'ready') {
    assert.equal(report.fileName, 'my-backup.x31backup')
    assert.deepEqual(report.preview, preview)
    // The document is passed through untouched — the renderer never edits it.
    assert.deepEqual(report.document, DOCUMENT)
  }
})

test('a refused file keeps the main process message, a failure does not invent one', async () => {
  const rejected = await runBackupInspect({
    bridge: fakeBridge({
      inspect: async () => ({
        outcome: 'rejected',
        reason: 'unsupported-version',
        message: 'That backup was written by a newer version of x31Desk.',
      }),
    }),
  })

  assert.deepEqual(rejected, {
    kind: 'rejected',
    message: 'That backup was written by a newer version of x31Desk.',
  })

  const failed = await runBackupInspect({
    bridge: fakeBridge({ inspect: async () => ({ outcome: 'failed', kind: 'unavailable' }) }),
  })

  assert.equal(failed.kind, 'failed')
})

test('a bridge that rejects during inspect becomes a typed failure', async () => {
  const report = await runBackupInspect({
    bridge: fakeBridge({
      inspect: async () => {
        throw new Error('ipc exploded')
      },
    }),
  })

  assert.equal(report.kind, 'failed')
})

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

test('an import hands the document and the chosen mode straight to the main process', async () => {
  let seen: { document: BackupDocument; mode: string } | null = null

  await runBackupImport({
    bridge: fakeBridge({
      apply: async (request) => {
        seen = request
        return applied()
      },
    }),
    document: DOCUMENT,
    mode: 'replace',
    storage: createFakeStorage(),
  })

  assert.deepEqual(seen, { document: DOCUMENT, mode: 'replace' })
})

test('a merge that added records needs a reload and says what it added', async () => {
  const report = await runBackupImport({
    bridge: fakeBridge({
      apply: async () => applied({ counts: { notes: 2, tasks: 1, snippets: 0, archive: 0 } }),
    }),
    document: DOCUMENT,
    mode: 'merge',
    storage: createFakeStorage(),
  })

  assert.equal(report.kind, 'applied')

  if (report.kind === 'applied') {
    assert.equal(report.noop, false)
    assert.equal(report.needsReload, true)
    assert.equal(report.preferencesRestored, false)
    assert.match(report.message, /Imported/)
    assert.match(report.message, /2 notes and 1 task/)
  }
})

test('a merge that wrote nothing is a no-op and does not reload', async () => {
  const storage = createFakeStorage()

  const report = await runBackupImport({
    bridge: fakeBridge({
      apply: async () =>
        applied({
          counts: { notes: 0, tasks: 0, snippets: 0, archive: 0 },
          unchanged: { notes: 1, tasks: 0, snippets: 0, archive: 0 },
        }),
    }),
    document: DOCUMENT,
    mode: 'merge',
    storage,
  })

  assert.equal(report.kind, 'applied')

  if (report.kind === 'applied') {
    assert.equal(report.noop, true)
    assert.equal(report.needsReload, false)
    assert.match(report.message, /Nothing to import/)
  }

  assert.deepEqual(storage.dump(), {})
})

test('a merge that only found conflicts changes nothing and says so', async () => {
  const report = await runBackupImport({
    bridge: fakeBridge({
      apply: async () =>
        applied({
          counts: { notes: 0, tasks: 0, snippets: 0, archive: 0 },
          conflicts: [{ collection: 'notes', id: 'n1' }],
        }),
    }),
    document: DOCUMENT,
    mode: 'merge',
    storage: createFakeStorage(),
  })

  assert.equal(report.kind, 'applied')

  if (report.kind === 'applied') {
    assert.equal(report.noop, true)
    assert.equal(report.needsReload, false)
    assert.equal(report.conflicts.length, 1)
    assert.match(report.message, /different content/)
    assert.match(report.message, /Nothing was changed/)
  }
})

test('restored preferences are written and make the import a real change', async () => {
  const storage = createFakeStorage()

  const report = await runBackupImport({
    bridge: fakeBridge({
      apply: async () =>
        applied({
          counts: { notes: 0, tasks: 0, snippets: 0, archive: 0 },
          preferences: { theme: 'dark', editor: EDITOR },
        }),
    }),
    document: DOCUMENT,
    mode: 'merge',
    storage,
  })

  assert.equal(report.kind, 'applied')

  if (report.kind === 'applied') {
    assert.equal(report.preferencesRestored, true)
    assert.equal(report.noop, false)
    // Nothing was imported, but the preferences changed, so the page reloads.
    assert.equal(report.needsReload, true)
    assert.match(report.message, /preferences were restored/)
  }

  assert.equal(storage.getItem(STORAGE_KEYS.theme), 'dark')
  assert.equal(storage.getItem(STORAGE_KEYS.editor), JSON.stringify(EDITOR))
})

test('a replace always needs a reload, even when it changed nothing', async () => {
  const report = await runBackupImport({
    bridge: fakeBridge({
      apply: async () =>
        applied({
          mode: 'replace',
          counts: { notes: 0, tasks: 0, snippets: 0, archive: 0 },
        }),
    }),
    document: DOCUMENT,
    mode: 'replace',
    storage: createFakeStorage(),
  })

  assert.equal(report.kind, 'applied')

  if (report.kind === 'applied') {
    assert.equal(report.noop, false)
    assert.equal(report.needsReload, true)
    assert.match(report.message, /Restored/)
  }
})

test('an import refused or failed on the main process side is reported, never thrown', async () => {
  const rejected = await runBackupImport({
    bridge: fakeBridge({
      apply: async () => ({
        outcome: 'rejected',
        reason: 'too-large',
        message: 'That backup is larger than x31Desk can import.',
      }),
    }),
    document: DOCUMENT,
    mode: 'merge',
    storage: createFakeStorage(),
  })

  assert.deepEqual(rejected, {
    kind: 'rejected',
    message: 'That backup is larger than x31Desk can import.',
  })

  const failed = await runBackupImport({
    bridge: fakeBridge({ apply: async () => ({ outcome: 'failed', kind: 'quota' }) }),
    document: DOCUMENT,
    mode: 'merge',
    storage: createFakeStorage(),
  })

  assert.equal(failed.kind, 'failed')

  const thrown = await runBackupImport({
    bridge: fakeBridge({
      apply: async () => {
        throw new Error('ipc exploded')
      },
    }),
    document: DOCUMENT,
    mode: 'merge',
    storage: createFakeStorage(),
  })

  assert.equal(thrown.kind, 'failed')
})

test('an import without the desktop bridge is unsupported', async () => {
  assert.deepEqual(
    await runBackupImport({
      document: DOCUMENT,
      mode: 'merge',
      storage: createFakeStorage(),
    }),
    { kind: 'unsupported' },
  )
})

// ---------------------------------------------------------------------------
// the Settings surface
// ---------------------------------------------------------------------------
// Native dialogs cannot be driven from a test, so what is pinned here is the
// shape the page renders: both rows present, gated on the shell, and the two
// destructive-free and destructive steps kept as separate dialogs.

const at = (relative: string) => new URL(relative, import.meta.url)

test('the Settings page mounts the backup rows in the Workspace section', () => {
  const source = readFileSync(at('../src/pages/SettingsPage.tsx'), 'utf8')

  assert.match(source, /<BackupData/, 'Settings should render the backup rows')
  assert.match(
    source,
    /<BackupData isDesktop=\{isDesktop\} \/>/,
    'the rows should be gated on whether the shell is present',
  )
})

test('both backup rows are labelled and disabled without the desktop shell', () => {
  const source = readFileSync(at('../src/components/settings/BackupData.tsx'), 'utf8')

  assert.match(source, /title="Back up data"/)
  assert.match(source, /title="Import from backup"/)
  // Two controls, both disabled when the shell is absent — never a live button
  // that fails only after it is clicked.
  assert.equal(source.match(/disabled=\{!isDesktop \|\| busy !== null\}/g)?.length, 2)
  assert.match(
    source,
    /Backups are only available in the desktop app/,
    'the browser copy should say why rather than appear broken',
  )
})

test('the preview and the destructive confirmation are two separate dialogs', () => {
  const source = readFileSync(at('../src/components/settings/BackupData.tsx'), 'utf8')

  // The preview is the native modal, opened imperatively, so focus trapping and
  // `Esc` are the browser's job.
  assert.match(source, /<dialog/)
  assert.match(source, /showModal\(\)/)

  // Replacing is its own confirmation, styled as destructive, and the preview
  // alone must never perform it directly.
  assert.match(source, /<ConfirmDialog/)
  assert.match(source, /destructive/)
  assert.match(source, /confirmDescription/)
})

test('the renderer backup flow reaches only the three named bridge methods', () => {
  const source = readFileSync(at('../src/data/backup.ts'), 'utf8')

  assert.match(source, /bridge\.create\(\{/)
  assert.match(source, /bridge\.inspect\(\)/)
  assert.match(source, /bridge\.apply\(\{/)
  // No generic invoker and no channel names — the preload exposes named methods
  // precisely so a renderer cannot address a channel the shell never published.
  assert.doesNotMatch(source, /ipcRenderer/)
  assert.doesNotMatch(source, /x31desk:/)
  assert.doesNotMatch(source, /\.invoke\(/)
})

test('the backup UI introduces no transform-based scaling', () => {
  const source = readFileSync(at('../src/components/settings/BackupData.tsx'), 'utf8')

  assert.doesNotMatch(source, /transform:/)
  assert.doesNotMatch(source, /scale\(/)
})
