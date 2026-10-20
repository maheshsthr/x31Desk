// x31Desk — end-to-end probe for the desktop shell.
// ---------------------------------------------------------------------------
// Not part of `npm test`: it launches a real Electron window, so it is kept as
// its own script (`npm run test:e2e`). It drives the *built* app over the
// DevTools protocol using Node's built-in WebSocket — no test dependency — and
// checks the things that only exist when the real pieces are wired together:
//
//   1. the preload bridge is present and its repository calls reach SQLite;
//   2. the *application* reads SQLite: the note below has never been in
//      `localStorage`, and the import marker already exists so nothing is
//      re-imported — if it renders, the app is bound to SQLite and not to the
//      old store;
//   3. a record survives an app restart;
//   4. a corrupt archive row is skipped by `list()`, preserved verbatim, and
//      readable through the read-only recovery channel;
//   5. closing runs the flush handshake and then closes the database;
//   6. Settings reports the SQLite backend rather than the web-only wording;
//   7. the keyboard shortcuts dispatch in the real window — `Ctrl+1`…`Ctrl+6`
//      navigate, `Ctrl+N` creates what the section holds, navigation stands
//      down behind a modal dialog, `Esc` closes it, and `F2` renames;
//   8. `F5` saves pending work and reloads the renderer.
//
// Every run uses a fresh directory under the OS temp dir and never the user's
// real profile. The app is closed with `taskkill` *without* `/F`, which posts the
// same WM_CLOSE an orderly quit uses.
//
// Usage:
//   npm run test:e2e                                     # the dev build
//   X31DESK_EXE=<path> X31DESK_PACKAGED=1 npm run test:e2e  # a packaged build
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXE = process.env.X31DESK_EXE ?? join(ROOT, 'node_modules/electron/dist/electron.exe')
// The dev build takes the app directory; a packaged build is the app itself.
const APP_ARGS = process.env.X31DESK_PACKAGED === '1' ? [] : ['.']
const PORT = Number(process.env.X31DESK_DEVTOOLS_PORT ?? 9333)
const PROFILE = mkdtempSync(join(tmpdir(), 'x31desk-e2e-'))

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function launch(label) {
  const logs = []
  const child = spawn(
    EXE,
    [...APP_ARGS, `--user-data-dir=${PROFILE}`, '--disable-gpu', `--remote-debugging-port=${PORT}`, '--no-first-run'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()))
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()))

  // Wait for a CDP page target.
  const deadline = Date.now() + 30000
  let page = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await response.json()
      page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page) break
    } catch {
      // not listening yet
    }
    await sleep(250)
  }

  if (!page) {
    child.kill()
    throw new Error(`${label}: no CDP page target within 30s`)
  }

  const websocket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    websocket.addEventListener('open', resolve, { once: true })
    websocket.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  websocket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  })

  function send(method, params) {
    return new Promise((resolve) => {
      const id = ++nextId
      pending.set(id, resolve)
      websocket.send(JSON.stringify({ id, method, params }))
    })
  }

  async function evaluate(expression) {
    const message = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    const result = message.result
    if (result?.exceptionDetails) {
      throw new Error(`${label}: ${result.exceptionDetails.exception?.description ?? 'exception'}`)
    }
    return result?.result?.value
  }

  /**
   * Presses a key through the input pipeline (CDP `Input`), so the keystroke is
   * trusted and takes the same route a physical key does. `keyCode` is the
   * Windows virtual-key code (digits 49–54, N 78, F2 113, F5 116, Escape 27);
   * the CDP modifier bit field is 1 = Alt, 2 = Ctrl, 4 = Meta, 8 = Shift.
   */
  async function pressKey({ key, code, ctrl = false, keyCode = 0 }) {
    const base = {
      key,
      code: code ?? key,
      modifiers: ctrl ? 2 : 0,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    }
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  // The renderer needs a moment to mount and answer. Poll the bridge into
  // existence, then give the app one more beat to finish its startup work.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await evaluate(
      'Boolean(window.x31deskDesktop && window.x31deskDesktop.notes && window.x31deskDesktop.recovery)',
    )
    if (ready) break
    await sleep(250)
  }
  await sleep(1500)

  return { child, logs, websocket, evaluate, pressKey }
}

async function closeGracefully(run) {
  // `taskkill` without `/F` posts WM_CLOSE — the orderly path, which must run the
  // flush handshake before the database is closed.
  spawnSync('taskkill', ['/PID', String(run.child.pid)], { stdio: 'ignore' })

  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (run.child.exitCode !== null || run.child.signalCode !== null) break
    await sleep(250)
  }

  const closed = run.child.exitCode !== null || run.child.signalCode !== null
  if (!closed) {
    run.child.kill()
  }
  run.websocket.close?.()

  return { closed, log: run.logs.join('') }
}

/** Clicks the nav entry whose label matches `label`. */
async function openView(evaluate, label) {
  const opened = await evaluate(
    `(() => {
      const candidates = [...document.querySelectorAll('a,button,[role="tab"],[role="link"],[role="button"]')]
      const target = candidates.find((el) => {
        const text = (el.querySelector('[data-nav-label]')?.innerText || el.innerText || '').trim()
        return text === ${JSON.stringify(label)}
      })
      if (!target) return false
      target.click()
      return true
    })()`,
  )
  await sleep(1200)
  return { opened: opened === true, body: String(await evaluate('document.body.innerText')) }
}

const NOTE = { id: 'e2e-note', title: 'E2E note', content: 'hello', createdAt: 1000, updatedAt: 1000 }
const ARCHIVE_ITEM = { type: 'note', archivedAt: 2000, note: NOTE }

try {
  console.log(`exe:      ${EXE}\nprofile:  ${PROFILE}\n`)

  // -------------------------------------------------------------------------
  // Run 1: write through the bridge.
  // -------------------------------------------------------------------------
  const first = await launch('run1')

  const booted = await first.evaluate('Boolean(window.x31deskDesktop.isDesktop)')
  check('the bridge is present in the renderer', booted === true)

  const insertResult = await first.evaluate(
    `window.x31deskDesktop.notes.insert(${JSON.stringify({ note: NOTE })})`,
  )
  check('notes.insert resolves with ok', insertResult?.ok === true, JSON.stringify(insertResult))

  const listed = await first.evaluate('window.x31deskDesktop.notes.list()')
  check(
    'the note reads back from SQLite',
    listed?.ok === true && listed.value?.some((note) => note.id === NOTE.id),
    JSON.stringify(listed),
  )

  const added = await first.evaluate(
    `window.x31deskDesktop.archive.add(${JSON.stringify({ entry: ARCHIVE_ITEM })})`,
  )
  check('archive.add resolves with ok', added?.ok === true, JSON.stringify(added))

  const vaultBefore = await first.evaluate('window.x31deskDesktop.recovery.archiveCorruption()')
  check(
    'the recovery channel is empty before any corruption',
    vaultBefore?.ok === true && vaultBefore.value?.length === 0,
    JSON.stringify(vaultBefore),
  )

  const firstClose = await closeGracefully(first)
  check('run 1 exited through the close handshake', firstClose.closed === true)
  check('run 1 flushed the renderer before closing', firstClose.log.includes('renderer flushed; closing'))
  check('run 1 closed the database', firstClose.log.includes('database closed'))

  // -------------------------------------------------------------------------
  // Corrupt the archive row behind the app's back.
  // -------------------------------------------------------------------------
  const dbPath = join(PROFILE, 'x31desk.db')
  const db = new DatabaseSync(dbPath)
  db.prepare("UPDATE archive SET data = 'not json at all' WHERE type = 'note' AND record_id = ?").run(
    NOTE.id,
  )
  const rowStillThere = db.prepare('SELECT COUNT(*) AS n FROM archive').get().n
  db.close()
  check('the archive row is still stored (only its payload was made unreadable)', rowStillThere === 1)

  // -------------------------------------------------------------------------
  // Run 2: restart, read back, and confirm the corruption was preserved.
  // -------------------------------------------------------------------------
  const second = await launch('run2')

  const noteSurvived = await second.evaluate('window.x31deskDesktop.notes.list()')
  check(
    'the note survives a restart',
    noteSurvived?.ok === true && noteSurvived.value?.some((note) => note.id === NOTE.id),
    JSON.stringify(noteSurvived),
  )

  // The strongest check: does the *application itself* read SQLite? On this run
  // the import marker already exists, so nothing is re-imported and `localStorage`
  // is never consulted for data. The note below was written over the bridge and
  // has never been in `localStorage`; if it appears once the Notes view is open,
  // the app is genuinely bound to SQLite rather than reading the old store.
  const mounted = await second.evaluate('document.body.innerText')
  check('the application is mounted, not on the failure screen', !String(mounted).includes('could not open'))

  const notes = await openView(second.evaluate, 'Notes')
  check(
    'the SQLite-only note is rendered by the application',
    notes.opened && notes.body.includes('E2E note'),
    `body: ${notes.body.replace(/\s+/g, ' ').slice(0, 300)}`,
  )

  // Settings should report the real backend, not the stale "local browser
  // storage" wording from the web build.
  const settings = await openView(second.evaluate, 'Settings')
  check(
    'Settings reports the SQLite backend',
    settings.opened && settings.body.includes('SQLite database'),
    `body: ${settings.body.replace(/\s+/g, ' ').slice(0, 300)}`,
  )

  // The backup rows are present and usable. The export/import flows themselves
  // go through *native* dialogs, which cannot be driven from the page, so this
  // asserts the surface the shell publishes and the state of the controls
  // rather than pretending to complete a backup from here.
  check(
    'Settings offers the backup and import rows',
    settings.body.includes('Back up data') && settings.body.includes('Import from backup'),
    `body: ${settings.body.replace(/\s+/g, ' ').slice(0, 400)}`,
  )

  const backupButtons = await second.evaluate(
    `(() => {
      const buttons = [...document.querySelectorAll('button')]
      const wanted = buttons.filter((b) => /Back up|Import/.test(b.innerText || ''))
      return wanted.map((b) => ({ label: b.innerText.trim(), disabled: b.disabled }))
    })()`,
  )
  check(
    'both backup controls are enabled in the desktop shell',
    Array.isArray(backupButtons) &&
      backupButtons.length === 2 &&
      backupButtons.every((button) => button.disabled === false),
    JSON.stringify(backupButtons),
  )

  const backupSurface = await second.evaluate(
    'Object.keys(window.x31deskDesktop.backup).sort().join(",")',
  )
  check(
    'the preload exposes exactly the three backup calls',
    backupSurface === 'apply,create,inspect',
    `surface: ${String(backupSurface)}`,
  )

  const archiveListed = await second.evaluate('window.x31deskDesktop.archive.list()')
  check(
    'the corrupt archive row is skipped by list()',
    archiveListed?.ok === true && archiveListed.value?.length === 0,
    JSON.stringify(archiveListed),
  )

  const vaultAfter = await second.evaluate('window.x31deskDesktop.recovery.archiveCorruption()')
  const entry = vaultAfter?.value?.[0]
  check(
    'the corrupt row is preserved and readable via the recovery channel',
    vaultAfter?.ok === true &&
      vaultAfter.value?.length === 1 &&
      entry?.data === 'not json at all' &&
      entry?.type === 'note' &&
      entry?.recordId === NOTE.id,
    JSON.stringify(vaultAfter),
  )

  // -------------------------------------------------------------------------
  // Keyboard shortcuts, in the real window over the input pipeline.
  // -------------------------------------------------------------------------
  const activeNav = async () =>
    String(await second.evaluate("document.querySelector('[aria-current=\"page\"]')?.innerText.trim() ?? ''"))

  // The sidebar order is the binding order: Ctrl+1 … Ctrl+6.
  const navSweep = [
    { key: '1', keyCode: 49, label: 'Home' },
    { key: '2', keyCode: 50, label: 'Notes' },
    { key: '3', keyCode: 51, label: 'Tasks' },
    { key: '4', keyCode: 52, label: 'Snippets' },
    { key: '5', keyCode: 53, label: 'Archive' },
    { key: '6', keyCode: 54, label: 'Settings' },
  ]

  const navFailures = []
  for (const step of navSweep) {
    await second.pressKey({ key: step.key, code: `Digit${step.key}`, ctrl: true, keyCode: step.keyCode })
    await sleep(400)
    const active = await activeNav()
    if (active !== step.label) {
      navFailures.push(`Ctrl+${step.key} → ${active || '(none)'} (want ${step.label})`)
    }
  }
  check('Ctrl+1 … Ctrl+6 navigate the sidebar sections', navFailures.length === 0, navFailures.join('; '))

  // Back on Settings after the sweep: the section must show the real bindings.
  const shortcutList = String(await second.evaluate('document.body.innerText'))
  check(
    'Settings lists the implemented shortcuts',
    shortcutList.includes('Keyboard Shortcuts') &&
      shortcutList.includes('Ctrl + 1') &&
      shortcutList.includes('F5'),
    `body: ${shortcutList.replace(/\s+/g, ' ').slice(0, 300)}`,
  )

  // Ctrl+N creates what the current section holds — a task dialog on Tasks…
  await second.pressKey({ key: '3', code: 'Digit3', ctrl: true, keyCode: 51 })
  await sleep(400)
  await second.pressKey({ key: 'n', code: 'KeyN', ctrl: true, keyCode: 78 })
  await sleep(500)
  const dialogOpened = await second.evaluate("Boolean(document.querySelector('dialog[open]'))")
  check('Ctrl+N opens the new-task dialog on Tasks', dialogOpened === true)

  // …and navigation stands down behind it, so the form is never discarded…
  await second.pressKey({ key: '1', code: 'Digit1', ctrl: true, keyCode: 49 })
  await sleep(400)
  const held = await activeNav()
  check('navigation shortcuts stand down while a dialog is open', held === 'Tasks', `active: ${held}`)

  // …while Escape still closes the dialog through its native cancel event.
  await second.pressKey({ key: 'Escape', code: 'Escape', keyCode: 27 })
  await sleep(500)
  const dialogClosed = await second.evaluate("!document.querySelector('dialog[open]')")
  check('Escape closes the open dialog', dialogClosed === true)

  // On Notes, Ctrl+N creates a note and F2 focuses its title for renaming.
  await second.pressKey({ key: '2', code: 'Digit2', ctrl: true, keyCode: 50 })
  await sleep(400)
  await second.pressKey({ key: 'n', code: 'KeyN', ctrl: true, keyCode: 78 })
  await sleep(600)
  const freshNote = await second.evaluate(
    "Boolean(document.querySelector('input[placeholder=\"Untitled note\"]'))",
  )
  check('Ctrl+N on Notes creates a fresh note', freshNote === true)

  await second.evaluate("document.activeElement && document.activeElement.blur()")
  await second.pressKey({ key: 'F2', code: 'F2', keyCode: 113 })
  await sleep(300)
  const renameFocused = await second.evaluate(
    "Boolean(document.activeElement && document.activeElement.matches('[data-rename-target]'))",
  )
  check('F2 focuses the note title for renaming', renameFocused === true)

  const secondClose = await closeGracefully(second)
  check('run 2 exited through the close handshake', secondClose.closed === true)
  check('run 2 closed the database', secondClose.log.includes('database closed'))

  // -------------------------------------------------------------------------
  // Run 3: F5 saves and refreshes. Kept to its own run because the check *is*
  // a reload: everything else above would have to survive one.
  // -------------------------------------------------------------------------
  const third = await launch('run3')

  await third.evaluate('window.__x31RefreshMarker = "before"')
  await third.pressKey({ key: 'F5', code: 'F5', keyCode: 116 })

  let refreshed = { marker: 'before', ready: false }
  const refreshDeadline = Date.now() + 15000
  while (Date.now() < refreshDeadline) {
    refreshed = await third.evaluate(
      '({ marker: window.__x31RefreshMarker ?? null, ready: Boolean(window.x31deskDesktop && window.x31deskDesktop.notes) })',
    )
    if (refreshed.marker === null && refreshed.ready === true) break
    await sleep(250)
  }
  check(
    'F5 saves pending work and refreshes the renderer',
    refreshed.marker === null && refreshed.ready === true,
    JSON.stringify(refreshed),
  )

  const thirdClose = await closeGracefully(third)
  check('run 3 exited through the close handshake', thirdClose.closed === true)
  check('run 3 closed the database', thirdClose.log.includes('database closed'))

  // -------------------------------------------------------------------------
  // Final state.
  // -------------------------------------------------------------------------
  const finalDb = new DatabaseSync(dbPath, { readOnly: true })
  const vaultRows = finalDb.prepare('SELECT COUNT(*) AS n FROM archive_corruption').get().n
  const version = finalDb.prepare('PRAGMA user_version').get().user_version
  finalDb.close()
  check('the vault holds exactly one preserved row', vaultRows === 1)
  check('the database is at schema v2', version === 2)
} catch (error) {
  check('the probe ran to completion', false, error instanceof Error ? error.message : String(error))
} finally {
  // Never leave the temp profile or an Electron process behind.
  spawnSync('taskkill', ['/IM', basename(EXE), '/F'], { stdio: 'ignore' })
  rmSync(PROFILE, { recursive: true, force: true })
  console.log('\nprofile removed:', !existsSync(PROFILE))
}

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
