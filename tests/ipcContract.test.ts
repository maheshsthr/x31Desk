// Focused tests for the shared IPC contract:
//   * every channel is namespaced and unique, so the main process, the preload
//     and the renderer cannot drift apart;
//   * the set of channels is exactly the one the shell publishes today, so a
//     channel cannot be added, removed or renamed without this test saying so.
//
// Dependency-free: Node's built-in test runner and type stripping only.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { IPC_CHANNELS, IPC_CHANNEL_PREFIX } from '@/data/ipc/contract'

const channels = Object.values(IPC_CHANNELS)

test('every channel is namespaced with the product prefix', () => {
  for (const channel of channels) {
    assert.ok(
      channel.startsWith(IPC_CHANNEL_PREFIX),
      `${channel} does not start with ${IPC_CHANNEL_PREFIX}`,
    )
    assert.ok(
      channel.length > IPC_CHANNEL_PREFIX.length,
      `${channel} has no name after the prefix`,
    )
  }
})

test('channel names are unique', () => {
  assert.equal(new Set(channels).size, channels.length)
})

test('the contract publishes exactly the expected channels', () => {
  assert.deepEqual([...channels].sort(), [
    'x31desk:app-info',
    'x31desk:archive.add',
    'x31desk:archive.clear',
    'x31desk:archive.corruption',
    'x31desk:archive.list',
    'x31desk:archive.remove',
    'x31desk:backup.apply',
    'x31desk:backup.export',
    'x31desk:backup.inspect',
    'x31desk:lifecycle.flush-request',
    'x31desk:lifecycle.flush-result',
    'x31desk:migration.import',
    'x31desk:migration.status',
    'x31desk:notes.clear',
    'x31desk:notes.create',
    'x31desk:notes.insert',
    'x31desk:notes.list',
    'x31desk:notes.remove',
    'x31desk:notes.update',
    'x31desk:snippets.clear',
    'x31desk:snippets.create',
    'x31desk:snippets.insert',
    'x31desk:snippets.list',
    'x31desk:snippets.remove',
    'x31desk:snippets.update',
    'x31desk:tasks.clear',
    'x31desk:tasks.create',
    'x31desk:tasks.insert',
    'x31desk:tasks.list',
    'x31desk:tasks.remove',
    'x31desk:tasks.setCompleted',
    'x31desk:tasks.update',
    'x31desk:theme.set-source',
    'x31desk:window.close',
    'x31desk:window.maximized-changed',
    'x31desk:window.minimize',
    'x31desk:window.state',
    'x31desk:window.toggle-maximize',
  ])
})
