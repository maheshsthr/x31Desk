/**
 * The type contract for the Electron preload bridge.
 * ---------------------------------------------------------------------------
 * `electron/preload.ts` (bundled to `electron/dist/preload.cjs`) publishes a
 * single global, `window.x31deskDesktop`, only when the app is running inside
 * the Electron shell. This module describes that surface so renderer code can
 * use it with real types instead of casting, and declares the global itself.
 *
 * The bridge is absent in a normal browser, so the global is optional and every
 * consumer must handle `undefined`. The repository methods below are the seam the
 * SQLite adapters in `src/data/ipc/` are built against; the desktop shell binds
 * them once the database is open and the one-time import has completed (see
 * `src/data/desktopStorage.ts`).
 */

import type {
  AppInfoResponse,
  FlushReport,
  IpcChannel,
  IpcRequest,
  IpcResponse,
  IpcResult,
  WindowStateResult,
} from '@/data/ipc/contract'
import { IPC_CHANNELS } from '@/data/ipc/contract'

/**
 * The versions the main process reports for the running shell.
 *
 * Defined by the IPC contract, since it is the response of the
 * `x31desk:app-info` channel; aliased here so bridge consumers keep a
 * bridge-shaped name.
 */
export type DesktopAppInfo = AppInfoResponse

/**
 * One bridge call: it takes a channel's request object and resolves with that
 * channel's result envelope. Typing calls this way ties the bridge to the
 * contract, so a method can never be pointed at the wrong channel.
 */
export type DesktopCall<C extends IpcChannel> = (
  request: IpcRequest<C>,
) => Promise<IpcResult<IpcResponse<C>>>

/** The `NoteRepository` surface over IPC. */
export type DesktopNoteBridge = {
  list: DesktopCall<typeof IPC_CHANNELS.notesList>
  create: DesktopCall<typeof IPC_CHANNELS.notesCreate>
  update: DesktopCall<typeof IPC_CHANNELS.notesUpdate>
  insert: DesktopCall<typeof IPC_CHANNELS.notesInsert>
  remove: DesktopCall<typeof IPC_CHANNELS.notesRemove>
  clear: DesktopCall<typeof IPC_CHANNELS.notesClear>
}

/** The `TaskRepository` operations over IPC. */
export type DesktopTaskBridge = {
  list: DesktopCall<typeof IPC_CHANNELS.tasksList>
  create: DesktopCall<typeof IPC_CHANNELS.tasksCreate>
  update: DesktopCall<typeof IPC_CHANNELS.tasksUpdate>
  setCompleted: DesktopCall<typeof IPC_CHANNELS.tasksSetCompleted>
  insert: DesktopCall<typeof IPC_CHANNELS.tasksInsert>
  remove: DesktopCall<typeof IPC_CHANNELS.tasksRemove>
  clear: DesktopCall<typeof IPC_CHANNELS.tasksClear>
}

/** The `SnippetRepository` operations over IPC. */
export type DesktopSnippetBridge = {
  list: DesktopCall<typeof IPC_CHANNELS.snippetsList>
  create: DesktopCall<typeof IPC_CHANNELS.snippetsCreate>
  update: DesktopCall<typeof IPC_CHANNELS.snippetsUpdate>
  insert: DesktopCall<typeof IPC_CHANNELS.snippetsInsert>
  remove: DesktopCall<typeof IPC_CHANNELS.snippetsRemove>
  clear: DesktopCall<typeof IPC_CHANNELS.snippetsClear>
}

/** The `ArchiveRepository` operations over IPC. */
export type DesktopArchiveBridge = {
  list: DesktopCall<typeof IPC_CHANNELS.archiveList>
  add: DesktopCall<typeof IPC_CHANNELS.archiveAdd>
  remove: DesktopCall<typeof IPC_CHANNELS.archiveRemove>
  clear: DesktopCall<typeof IPC_CHANNELS.archiveClear>
}

/**
 * Recovery reads over IPC.
 *
 * Read-only, and intentionally not part of a repository: the vault holds the
 * bytes of an archive row that could not be read back, which no repository
 * method exposes. The Settings page reads it to offer those bytes for export.
 */
export type DesktopRecoveryBridge = {
  archiveCorruption: DesktopCall<typeof IPC_CHANNELS.archiveCorruption>
}

/**
 * The one-time `localStorage` → SQLite import, reached over IPC.
 *
 * Unlike a repository call, these resolve with the contract's own result type
 * rather than an {@link IpcResult} envelope: a conflict, an invalid source or a
 * verification failure is a decision the import *reports*, not a transport
 * failure, so there is nothing to unwrap.
 */
export type DesktopMigrationBridge = {
  /** Reads whether the import has already completed. */
  status: () => Promise<IpcResponse<typeof IPC_CHANNELS.migrationStatus>>
  /** Offers a validated `localStorage` snapshot for import. */
  import: (
    request: IpcRequest<typeof IPC_CHANNELS.migrationImport>,
  ) => Promise<IpcResponse<typeof IPC_CHANNELS.migrationImport>>
}

/**
 * The close handshake, reached over IPC.
 *
 * This is the one bridge group that is not request/response: the main process
 * *pushes* a flush request to the renderer through {@link onFlushRequest}, and
 * the renderer answers with {@link reportFlushResult}. Main will not destroy the
 * window until that answer arrives, so the two calls together are what lets a
 * debounced draft reach storage before the process goes away.
 */
export type DesktopLifecycleBridge = {
  /**
   * Registers a callback invoked when the main process asks to flush before
   * closing, and returns an unsubscribe. The payload the renderer receives is
   * empty, so the callback takes no arguments.
   */
  onFlushRequest: (handler: () => void) => () => void
  /** Reports whether the flush settled successfully, so main can stop waiting. */
  reportFlushResult: (report: FlushReport) => Promise<void>
}

/**
 * The shell's native chrome theme, reached over IPC.
 *
 * The renderer owns the theme preference; the main process owns the native
 * window chrome, so the two meet here. The value sent is the preference itself —
 * `system` keeps the OS in charge, `light`/`dark` pin Chromium's native
 * surfaces (context menu, colour scheme, `prefers-color-scheme`) to that
 * appearance even when the OS prefers the other.
 */
export type DesktopThemeBridge = {
  /** Mirrors the app's theme preference onto the shell's native chrome. */
  setSource: DesktopCall<typeof IPC_CHANNELS.themeSetSource>
}

/**
 * The window controls behind the custom title bar, reached over IPC.
 *
 * The window is frameless, so minimize/maximize/close and the maximize state
 * are the renderer's to draw and the main process's to perform. Every method
 * is a zero-argument call — the main process rejects any argument — and none
 * of them can be used to reach an arbitrary window: each one performs exactly
 * the single operation its name says. `close` takes the ordinary close path,
 * so the flush handshake runs before the window goes.
 *
 * Absent in a plain browser (where there is no window to control): the whole
 * bridge is, and the title bar renders without the button group.
 */
export type DesktopWindowControlsBridge = {
  /** Minimizes the window. */
  minimize: () => Promise<void>
  /** Maximizes an ordinary window, or restores a maximized one. */
  toggleMaximize: () => Promise<void>
  /** Closes the window through the flush handshake. */
  close: () => Promise<void>
  /** The maximize state, read once for the first paint. */
  getState: () => Promise<WindowStateResult>
  /** Subscribes to maximize-state changes from the main process. */
  onMaximizedChanged: (handler: (state: WindowStateResult) => void) => () => void
}

/**
 * A bridge call that resolves with the contract's own outcome rather than an
 * {@link IpcResult} envelope. Used where a cancelled dialog, a refused file and
 * a completed operation are all *decisions* the main process reports, so there
 * is nothing to unwrap.
 */
export type DesktopOutcomeCall<C extends IpcChannel> = (
  request: IpcRequest<C>,
) => Promise<IpcResponse<C>>

/**
 * Backup and restore of the whole workspace, reached over IPC.
 *
 * The three steps are deliberately separate calls: `inspect` opens the picker,
 * validates the file and returns both a preview for the confirmation dialog and
 * the document itself; `apply` is handed that document back and re-validates it
 * before any write. The main process therefore keeps no memory of which file
 * was chosen, and the renderer can show a preview without ever holding a path.
 */
export type DesktopBackupBridge = {
  /** Writes the workspace to a file chosen in a native save dialog. */
  create: DesktopOutcomeCall<typeof IPC_CHANNELS.backupExport>
  /** Opens a native picker, validates the file and returns a preview. */
  inspect: () => Promise<IpcResponse<typeof IPC_CHANNELS.backupInspect>>
  /** Merges or replaces the workspace with a previously inspected document. */
  apply: DesktopOutcomeCall<typeof IPC_CHANNELS.backupApply>
}

/**
 * The API the preload exposes on `window.x31deskDesktop`. It is intentionally
 * small: a capability is added here only when the shell has decided to publish
 * it.
 */
export type DesktopBridge = {
  /** Always `true`; its presence distinguishes the desktop build from the web. */
  readonly isDesktop: true
  /** Reads the running versions from the main process. */
  getAppInfo: () => Promise<DesktopAppInfo>
  /** The note store, reached over IPC. */
  readonly notes: DesktopNoteBridge
  /** The task store, reached over IPC. */
  readonly tasks: DesktopTaskBridge
  /** The snippet store, reached over IPC. */
  readonly snippets: DesktopSnippetBridge
  /** The archive, reached over IPC. */
  readonly archive: DesktopArchiveBridge
  /** Read-only recovery data (the archive corruption vault). */
  readonly recovery: DesktopRecoveryBridge
  /** The one-time `localStorage` → SQLite import. */
  readonly migration: DesktopMigrationBridge
  /** Backup and restore of the whole workspace. */
  readonly backup: DesktopBackupBridge
  /** The close handshake: main asks the renderer to flush before it closes. */
  readonly lifecycle: DesktopLifecycleBridge
  /** The shell's native chrome theme (Chromium's native colour scheme). */
  readonly theme: DesktopThemeBridge
  /** The frameless window's caption controls, drawn by the custom title bar. */
  readonly windowControls: DesktopWindowControlsBridge
}

declare global {
  interface Window {
    /** Present only when the renderer is running inside Electron. */
    readonly x31deskDesktop?: DesktopBridge
  }
}