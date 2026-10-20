// The main process's shutdown *ordering*, pinned at the source.
// ---------------------------------------------------------------------------
// `electron/main.ts` cannot be imported under Node — it pulls in `electron` —
// so its lifecycle wiring is checked the same way the preload boundary is in
// `ipcHandlers.test.ts`: by reading the source and asserting the order the
// pieces are registered in. What matters here is one ordering guarantee that the
// whole close handshake exists to provide:
//
//   The database is closed on `will-quit`, which fires only after every window
//   has closed. The window is held open by the close handshake until the
//   renderer has flushed. So the database stays open across the flush — it is
//   closed *after* the window closes, never before it.
//
// A regression here is silent and expensive (a WAL that never flushed, or a
// flush racing a closed connection), so the shape of the wiring is asserted
// rather than left to a future reader to notice.
//
// Dependency-free: Node's built-in test runner and type stripping.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')

/** The text between two markers, failing loudly if either is missing or out of order. */
function between(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)

  assert.notEqual(start, -1, `expected to find ${startMarker} in electron/main.ts`)
  assert.notEqual(end, -1, `expected to find ${endMarker} in electron/main.ts`)
  assert.ok(start < end, `expected ${startMarker} to appear before ${endMarker}`)

  return source.slice(start, end)
}

test('the database is closed on will-quit, not before', () => {
  const willQuitBody = between("app.on('will-quit'", "app.on('before-quit'")
  const beforeQuitBody = between("app.on('before-quit'", 'app.whenReady()')

  // `will-quit` fires after every window has closed — i.e. after the handshake
  // released the window — so this is the correct place to close the database.
  assert.match(willQuitBody, /closeDatabase\(\)/)

  // `before-quit` fires *before* the window is closed, so closing the database
  // there would race the renderer's flush. It must only mark the quit intent.
  assert.doesNotMatch(beforeQuitBody, /closeDatabase\(\)/)
  assert.match(beforeQuitBody, /quitRequested\s*=\s*true/)
})

test('a close request is held open and handed to the close handshake', () => {
  const closeBody = between("window.on('close'", "window.webContents.on('render-process-gone'")

  // The window must not be destroyed until the renderer has answered.
  assert.match(closeBody, /event\.preventDefault\(\)/)
  assert.match(closeBody, /handshake\.begin\(\)/)
  // A close after the handshake settled is released rather than held again.
  assert.match(closeBody, /handshake\.isSettled\(\)/)
})

test('a crashed renderer aborts the handshake rather than waiting it out', () => {
  const goneBody = between(
    "window.webContents.on('render-process-gone'",
    "window.on('closed'",
  )

  assert.match(goneBody, /handshake\.abort\(\)/)
})

test('the flush answer completes the handshake, and a stray one is not a success', () => {
  const flushBody = between(
    'ipcMain.handle(IPC_CHANNELS.flushResult',
    'const getDatabase =',
  )

  // A malformed or missing report is treated as an unsuccessful flush, never a
  // claimed success.
  assert.match(flushBody, /parseFlushReport\(args\[0\]\)/)
  assert.match(flushBody, /closeHandshake\.complete\(report \?\? \{ ok: false \}\)/)
  // An answer that arrives with no window is ignored.
  assert.match(flushBody, /closeHandshake === null/)
})

test('the terminate path destroys the window before it finishes a requested quit', () => {
  const terminateBody = between('terminate: (outcome) => {', 'closeHandshake = handshake')

  // The database is closed by `will-quit`, which only runs once the window is
  // gone, so the window must be destroyed here before any `app.quit()`.
  assert.ok(
    terminateBody.indexOf('window.destroy()') < terminateBody.indexOf('app.quit()'),
    'expected window.destroy() before app.quit() in the terminate path',
  )
})
