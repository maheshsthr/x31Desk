/**
 * x31Desk — Electron main process.
 * ---------------------------------------------------------------------------
 * The main process owns the application window and the lifecycle around it, and
 * the SQLite database. It holds no application *state* of its own: the notes,
 * tasks, snippets and archive live in the database, and the renderer's
 * repository adapters reach them only through the channels registered here. The
 * renderer decides whether those channels are authoritative (see
 * `src/data/desktopStorage.ts`) — this process simply publishes them, ready or
 * not.
 *
 * The renderer is the existing React application, unchanged. In development the
 * window points at the Vite dev server (so HMR works); in production it loads
 * the built `dist/index.html` over `file://`, which is why the Vite config uses
 * `base: './'`.
 *
 * This file is TypeScript and is bundled to `electron/dist/main.mjs` by
 * `scripts/build-electron.mjs`; the preload is bundled to CommonJS next to it,
 * because a sandboxed preload cannot be an ES module. Paths are resolved from
 * `app.getAppPath()` rather than from this module's own location, so they are
 * correct wherever the bundle is written.
 */
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, type IpcMainInvokeEvent, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { IPC_CHANNELS, type AppInfoResponse } from '@/data/ipc/contract'

import { BACKUP_EXTENSION, type BackupDialogs } from './db/backup.ts'
import { initializeDatabase, type AppDatabase } from './db/database.ts'
import { createCloseHandshake, type CloseHandshake, type CloseOutcome } from './lifecycle/closeHandshake.ts'
import { registerBackupHandlers } from './ipc/backupHandlers.ts'
import { registerMigrationHandlers } from './ipc/migrationHandlers.ts'
import { registerRecoveryHandlers } from './ipc/recoveryHandlers.ts'
import { registerRepositoryHandlers } from './ipc/repositoryHandlers.ts'
import { registerThemeHandlers } from './ipc/themeHandlers.ts'
import { registerWindowHandlers, wireWindowState } from './ipc/windowHandlers.ts'
import { parseFlushReport } from './ipc/validation.ts'

/**
 * Set by `scripts/dev-electron.mjs` to the running Vite dev-server URL. When it
 * is present the shell is in development and loads that URL instead of the
 * built bundle. Nothing else sets it, so a packaged build always falls through
 * to `dist/`.
 */
const devServerUrl = process.env.X31DESK_DEV_SERVER_URL ?? ''
const isDevelopment = devServerUrl !== ''

/**
 * Opens the window on the Nordic Blue canvas colour so the first paint does not
 * flash white before the renderer's own background is painted. Mirrors the
 * `--x31-color-canvas` token in the light theme.
 */
const WINDOW_BACKGROUND = '#F2F6FA'

let mainWindow: BrowserWindow | null = null

/**
 * The close handshake for the current window, or `null` when there is none.
 *
 * Set when the window is created and cleared when it is destroyed. The flush
 * answer handler reads it, so a stray answer after the window has gone is
 * ignored rather than crashing.
 */
let closeHandshake: CloseHandshake | null = null

/**
 * Whether an orderly quit is under way.
 *
 * Closing the last window quits on Windows and Linux, but macOS keeps the
 * process alive in the dock. When the quit was requested explicitly (Cmd+Q, the
 * menu, `app.quit()`), the app must quit once the renderer has flushed even
 * though `window-all-closed` will not do it on macOS; this flag is what lets the
 * handshake know to call `app.quit()` again.
 */
let quitRequested = false

/**
 * Whether the database is usable, and the reason it is not when it is not.
 *
 * There is no third "opening" state that could be mistaken for ready: until
 * `openDatabase()` succeeds the state is `unavailable`, and a failure leaves it
 * that way with the reason recorded. The application does not depend on the
 * database yet, so a failed open is reported and the shell carries on with the
 * renderer's existing `localStorage` storage rather than crashing.
 */
type DatabaseState =
  | { readonly status: 'ready'; readonly database: AppDatabase }
  | { readonly status: 'unavailable'; readonly reason: string }

let databaseState: DatabaseState = {
  status: 'unavailable',
  reason: 'the database has not been opened yet',
}

/**
 * Answers the renderer's read-only "what am I running inside?" request with the
 * versions the About surface can display.
 *
 * The handler takes no arguments and refuses any that are passed, so a
 * malformed call fails loudly rather than being silently tolerated. This is the
 * validation shape every data channel follows: decide the exact input, reject
 * everything else.
 */
function handleAppInfo(_event: IpcMainInvokeEvent, ...args: unknown[]): AppInfoResponse {
  if (args.length > 0) {
    throw new Error(`${IPC_CHANNELS.appInfo} does not accept arguments`)
  }

  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  }
}

/**
 * Opens and migrates the database in the platform's user-data directory.
 *
 * A failure is logged with its actionable reason and recorded as `unavailable`;
 * it is never swallowed and never upgraded to a ready state.
 */
function openDatabase(): void {
  try {
    const database = initializeDatabase(app.getPath('userData'))

    databaseState = { status: 'ready', database }
    console.log(`[x31desk] database ready at ${database.filePath} (schema v${database.version})`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)

    databaseState = { status: 'unavailable', reason }
    console.error(`[x31desk] database unavailable: ${reason}`)
  }
}

/** Closes the database on the way out, so WAL contents are flushed. */
function closeDatabase(): void {
  if (databaseState.status !== 'ready') {
    return
  }

  const { database } = databaseState

  try {
    database.close()
    console.log('[x31desk] database closed')
  } catch (error) {
    console.error('[x31desk] failed to close the database:', error)
  } finally {
    databaseState = { status: 'unavailable', reason: 'the database has been closed' }
  }
}

/**
 * Logs the handshake's terminal state.
 *
 * Only a successful flush is reported as a clean close; a timeout or a failed
 * flush is logged as data that may not have been persisted, because that is the
 * honest description of what happened.
 */
function reportCloseOutcome(outcome: CloseOutcome): void {
  switch (outcome.reason) {
    case 'flushed':
      if (outcome.ok) {
        console.log('[x31desk] renderer flushed; closing')
      } else {
        console.error('[x31desk] renderer reported a failed flush; closing anyway')
      }
      break
    case 'timeout':
      console.error('[x31desk] renderer flush timed out; closing anyway')
      break
    case 'unavailable':
      console.error('[x31desk] renderer could not be asked to flush; closing anyway')
      break
  }
}

/**
 * The application icon, for the Windows taskbar and the Alt-Tab switcher.
 *
 * (The window itself is frameless, so there is no caption icon to draw.)
 *
 * The packaged app carries the icon beside the archive as an extra resource (see
 * `extraResources` in `electron-builder.yml`); the development build reads the
 * same file from `build/`. When neither is present the option is omitted and
 * Windows falls back to the executable's own icon, so a missing file degrades
 * rather than throws.
 */
function resolveAppIcon(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'icon.ico')]
    : [join(app.getAppPath(), 'build', 'icon.ico')]

  return candidates.find((candidate) => existsSync(candidate))
}

/**
 * The native file dialogs the backup feature drives.
 *
 * Parented to the main window when there is one, so the picker is modal to the
 * app rather than free-floating; the window is read at call time because the
 * handlers are registered before the window exists. Both dialogs filter on the
 * backup extension, and both reduce Electron's rich result to the one thing the
 * backup flow needs — a path, or `null` for "the user cancelled" — so no
 * `canceled`/`filePaths` detail leaks past this boundary.
 */
function createBackupDialogs(): BackupDialogs {
  return {
    showSave: async (suggestedFileName) => {
      const options: SaveDialogOptions = {
        title: 'Back up x31Desk data',
        defaultPath: join(app.getPath('documents'), suggestedFileName),
        filters: [{ name: 'x31Desk backup', extensions: [BACKUP_EXTENSION] }],
      }

      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options)

      return result.canceled || !result.filePath ? null : result.filePath
    },

    showOpen: async () => {
      const options: OpenDialogOptions = {
        title: 'Import x31Desk backup',
        properties: ['openFile'],
        filters: [{ name: 'x31Desk backup', extensions: [BACKUP_EXTENSION] }],
      }

      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)

      const [filePath] = result.filePaths

      return result.canceled || filePath === undefined ? null : filePath
    },
  }
}

/**
 * Creates the application window with a locked-down renderer:
 * `contextIsolation` on, `nodeIntegration` off and the renderer sandboxed, with
 * only the preload bridge added to the page's global scope.
 */
function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 640,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    title: 'x31Desk',
    icon: resolveAppIcon(),
    autoHideMenuBar: true,
    // The window is frameless: Windows' standard caption is replaced by the
    // renderer's own title bar (`src/components/titlebar/TitleBar.tsx`), which
    // needs a full-bleed top row to draw in and to let the user drag the
    // window from anywhere on it. `thickFrame` deliberately keeps its default
    // (`true`), because that is what gives a frameless window the standard
    // resize edges and corners, the shadow and the snap behaviour — setting it
    // to `false` would disable resizing by dragging the window edges.
    frame: false,
    webPreferences: {
      preload: join(app.getAppPath(), 'electron', 'dist', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  // The window is not destroyed until the renderer has flushed, so a debounced
  // draft reaches storage before the process goes away. The database is likewise
  // kept open: it is closed on `will-quit`, which only fires after this
  // handshake has allowed the window to close.
  const handshake = createCloseHandshake({
    requestFlush: () => {
      window.webContents.send(IPC_CHANNELS.flushRequest)
    },
    terminate: (outcome) => {
      reportCloseOutcome(outcome)

      if (!window.isDestroyed()) {
        window.destroy()
      }

      // On macOS, destroying the last window does not quit. If the quit was
      // requested explicitly, finish it now that the renderer has flushed.
      if (quitRequested) {
        setImmediate(() => app.quit())
      }
    },
  })

  closeHandshake = handshake

  // Hold the first close request while the renderer flushes, and ignore a
  // repeated one. Once the handshake has settled the window is released (its
  // `destroy` bypasses this event, so this is only a safety net).
  window.on('close', (event) => {
    if (handshake.isSettled()) {
      return
    }

    event.preventDefault()
    handshake.begin()
  })

  // A crashed renderer will never answer, so stop waiting immediately rather
  // than holding the window (and the app) until the timeout.
  window.webContents.on('render-process-gone', () => {
    handshake.abort()
  })

  window.on('closed', () => {
    if (closeHandshake === handshake) {
      closeHandshake = null
    }
  })

  // The title bar's maximize button must follow the window wherever the state
  // moves from — the button itself, a snap to a screen edge, or the operating
  // system's own double-click on the drag region — so the push is wired once,
  // here, against this window.
  wireWindowState(window)

  // Reveal only once the first frame is ready, so the window never appears as a
  // blank white rectangle. Center to avoid appearing edge-to-edge or off-screen.
  window.once('ready-to-show', () => {
    window.show()
    if (!window.isMaximized()) {
      window.center()
    }
  })

  // The renderer is a single local document. A request to open a second window
  // is refused; a genuine external link is handed to the operating system's
  // browser instead of being loaded inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }

    return { action: 'deny' }
  })

  // In-app navigation is confined: in development the HMR client legitimately
  // reloads from the dev server, but in production the app never navigates —
  // the initial `file://` load is a programmatic `loadFile`, which does not
  // raise this event — so every other navigation is blocked rather than allowed
  // to replace the application.
  //
  // The one exception is a reload of the *current* document, which is how the
  // `F5` shortcut refreshes the workspace: the URL is unchanged, so the
  // application reloads in place instead of being replaced by another page.
  // Any different URL — including one crafted by script — is still refused.
  window.webContents.on('will-navigate', (event, url) => {
    const isReload = url === window.webContents.getURL()
    const allowed = isReload || (isDevelopment && url.startsWith(devServerUrl))

    if (!allowed) {
      event.preventDefault()
    }
  })

  const load = isDevelopment
    ? window.loadURL(devServerUrl)
    : window.loadFile(join(app.getAppPath(), 'dist', 'index.html'))

  load.catch((error) => {
    console.error('[x31desk] failed to load the renderer:', error)
  })

  return window
}

// One instance keeps one window, one storage origin and one database
// connection, which is how the app is meant to be used on the desktop. A second
// launch focuses the existing window.
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  // Gives the window its own identity in the Windows taskbar rather than being
  // grouped under the generic Electron entry.
  app.setAppUserModelId('com.x31desk.app')

  app.on('second-instance', () => {
    if (mainWindow === null) {
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    mainWindow.focus()
  })

  app.on('window-all-closed', () => {
    // Closing the last window quits on Windows and Linux. macOS keeps the
    // process alive in the dock, which is that platform's convention.
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })

  // `will-quit` fires for every orderly quit path, including the one
  // `window-all-closed` starts, so this is where the database is closed. It
  // runs after the close handshake has released the window, so the database
  // stays open until the renderer has finished flushing.
  app.on('will-quit', () => {
    closeDatabase()
  })

  // Marks that an orderly quit was requested. The close handshake consults it
  // to finish the quit once the renderer has flushed, even on macOS where
  // closing the last window does not quit. Idempotent: it only ever sets a flag.
  app.on('before-quit', () => {
    quitRequested = true
  })

  app.whenReady().then(() => {
    openDatabase()
    ipcMain.handle(IPC_CHANNELS.appInfo, handleAppInfo)

    // The renderer's answer to a flush request. A malformed answer is treated as
    // "not confirmed", and a stray answer with no window is ignored, so the
    // handler can never turn a bad payload into a reported success.
    ipcMain.handle(IPC_CHANNELS.flushResult, (_event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const report = args.length === 1 ? parseFlushReport(args[0]) : null

      if (closeHandshake === null) {
        console.error(`[x31desk] ${IPC_CHANNELS.flushResult} received with no active window`)

        return
      }

      closeHandshake.complete(report ?? { ok: false })
    })

    const getDatabase = () =>
      databaseState.status === 'ready' ? databaseState.database.connection : null

    registerRepositoryHandlers(ipcMain, getDatabase)
    registerMigrationHandlers(ipcMain, getDatabase)
    registerRecoveryHandlers(ipcMain, getDatabase)

    // Backup and restore: like migration, a whole-workspace operation rather
    // than a repository one, driving its own native dialogs.
    registerBackupHandlers(ipcMain, {
      getDatabase,
      dialogs: createBackupDialogs(),
      appVersion: app.getVersion(),
    })

    // The app's theme preference is mirrored onto `nativeTheme.themeSource`.
    // The window is frameless now, so there is no DWM caption left to colour,
    // but the value still steers Chromium's own native surfaces — the context
    // menu, native form-control colour scheme and the renderer's
    // `prefers-color-scheme`, which the app's `system` preference resolves
    // against. Registered before the window is created so the renderer's first
    // report can never arrive before the handler exists.
    registerThemeHandlers(ipcMain, nativeTheme)

    // The frameless window's controls (minimize, maximize/restore, close and
    // the state read). The provider is read per call, so registering before
    // the window exists is fine; the maximize-state push is wired inside
    // `createWindow`, where the window is.
    registerWindowHandlers(ipcMain, () =>
      mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow : null,
    )

    mainWindow = createWindow()
  })
}
