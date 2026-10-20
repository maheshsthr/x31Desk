// The main process's read-only recovery channel: the archive corruption vault.
// ---------------------------------------------------------------------------
// The handler exists so the Settings page can offer preserved archive bytes for
// export. These tests pin that it:
//
//   * lists exactly what the vault holds, verbatim;
//   * answers `unavailable` on a closed database instead of throwing;
//   * rejects a call that carries arguments;
//   * is registered on its own channel and forwards through the listener.
//
// A throwaway database in the OS temp directory is used — never the user's
// profile. Dependency-free: Node's built-in test runner, type stripping and
// `node:sqlite`.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { createArchiveQuarantine } from '../electron/db/archiveQuarantine.ts'
import { initializeDatabase, type AppDatabase } from '../electron/db/database.ts'
import { createRecoveryHandlers, registerRecoveryHandlers } from '../electron/ipc/recoveryHandlers.ts'
import { IPC_CHANNELS, type ArchiveCorruptionEntry } from '@/data/ipc/contract'

let root: string

before(() => {
  root = mkdtempSync(join(tmpdir(), 'x31desk-recovery-'))
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

const CORRUPT: ArchiveCorruptionEntry = {
  type: 'note',
  recordId: 'n1',
  archivedAt: 1700000000000,
  data: '{"type":"note","note":',
  detectedAt: 1700000001000,
}

test('the handler lists the preserved entries verbatim', async () => {
  await withDatabase('list.db', async (database) => {
    createArchiveQuarantine(database.connection).preserve(CORRUPT)

    const handlers = createRecoveryHandlers(() => database.connection)

    assert.deepEqual(await handlers.archiveCorruption([]), { ok: true, value: [CORRUPT] })
  })
})

test('an absent archived_at survives the round trip as null', async () => {
  await withDatabase('null-date.db', async (database) => {
    createArchiveQuarantine(database.connection).preserve({ ...CORRUPT, archivedAt: null })

    const handlers = createRecoveryHandlers(() => database.connection)

    assert.deepEqual(await handlers.archiveCorruption([]), {
      ok: true,
      value: [{ ...CORRUPT, archivedAt: null }],
    })
  })
})

test('an unavailable database is reported, not thrown', async () => {
  const handlers = createRecoveryHandlers(() => null)

  assert.deepEqual(await handlers.archiveCorruption([]), { ok: false, kind: 'unavailable' })
})

test('a call carrying arguments is rejected', async () => {
  const handlers = createRecoveryHandlers(() => null)

  assert.deepEqual(await handlers.archiveCorruption([{}]), { ok: false, kind: 'unknown' })
})

test('the channel is registered and its listener forwards the arguments', async () => {
  const registered = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
  const ipcMain = {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      registered.set(channel, listener)
    },
  }

  registerRecoveryHandlers(ipcMain, () => null)

  assert.deepEqual([...registered.keys()], [IPC_CHANNELS.archiveCorruption])

  const listener = registered.get(IPC_CHANNELS.archiveCorruption)
  assert.ok(listener)
  assert.deepEqual(await listener(null), { ok: false, kind: 'unavailable' })
})
