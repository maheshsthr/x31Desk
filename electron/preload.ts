/**
 * x31Desk — Electron preload bridge.
 * ---------------------------------------------------------------------------
 * Runs before the renderer and is the *only* thing that crosses the boundary
 * between the React application and the main process. It deliberately exposes a
 * small, named, explicitly typed surface — never `ipcRenderer` itself and never
 * a generic `invoke(channel, …)` — so the renderer can reach exactly the
 * capabilities the shell has decided to publish and nothing else.
 *
 * This is TypeScript source. It is bundled to CommonJS (`preload.cjs`) by
 * `scripts/build-electron.mjs`, because a sandboxed preload cannot be an ES
 * module and can only `require` a small set of built-in modules. Bundling also
 * means the channel names are now *shared* with the main process through
 * `src/data/ipc/contract.ts` instead of being mirrored by hand: the contract
 * imports only types, so it inlines as plain constants and never drags
 * application code into the sandbox.
 *
 * Each repository method returns the raw `IpcResult` envelope the main process
 * produced. It is deliberately *not* turned into a thrown error here: a thrown
 * error's prototype and custom properties do not reliably survive
 * `contextBridge`, whereas the plain envelope does. The renderer-side adapters
 * in `src/data/ipc/` unwrap it into their own `StorageError`.
 *
 * The matching `window.x31deskDesktop` type lives in `src/types/desktop.ts`.
 */
import { contextBridge, ipcRenderer } from 'electron'

import { IPC_CHANNELS, type WindowStateResult } from '@/data/ipc/contract'
import type { DesktopBridge } from '@/types/desktop'

const bridge: DesktopBridge = {
  /**
   * A constant the renderer can read synchronously to branch between the web
   * and desktop builds without awaiting anything.
   */
  isDesktop: true,

  /**
   * Resolves with the running versions, read in the main process. Returns a
   * promise because that is the shape every data call will have.
   */
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo),

  notes: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.notesList),
    create: () => ipcRenderer.invoke(IPC_CHANNELS.notesCreate),
    update: (request) => ipcRenderer.invoke(IPC_CHANNELS.notesUpdate, request),
    insert: (request) => ipcRenderer.invoke(IPC_CHANNELS.notesInsert, request),
    remove: (request) => ipcRenderer.invoke(IPC_CHANNELS.notesRemove, request),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.notesClear),
  },

  tasks: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.tasksList),
    create: (request) => ipcRenderer.invoke(IPC_CHANNELS.tasksCreate, request),
    update: (request) => ipcRenderer.invoke(IPC_CHANNELS.tasksUpdate, request),
    setCompleted: (request) => ipcRenderer.invoke(IPC_CHANNELS.tasksSetCompleted, request),
    insert: (request) => ipcRenderer.invoke(IPC_CHANNELS.tasksInsert, request),
    remove: (request) => ipcRenderer.invoke(IPC_CHANNELS.tasksRemove, request),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.tasksClear),
  },

  snippets: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.snippetsList),
    create: (request) => ipcRenderer.invoke(IPC_CHANNELS.snippetsCreate, request),
    update: (request) => ipcRenderer.invoke(IPC_CHANNELS.snippetsUpdate, request),
    insert: (request) => ipcRenderer.invoke(IPC_CHANNELS.snippetsInsert, request),
    remove: (request) => ipcRenderer.invoke(IPC_CHANNELS.snippetsRemove, request),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.snippetsClear),
  },

  archive: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.archiveList),
    add: (request) => ipcRenderer.invoke(IPC_CHANNELS.archiveAdd, request),
    remove: (request) => ipcRenderer.invoke(IPC_CHANNELS.archiveRemove, request),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.archiveClear),
  },

  recovery: {
    /**
     * Reads the archive corruption vault. Read-only: the renderer can list what
     * could not be read back, but nothing on this group writes, moves or
     * deletes an entry.
     */
    archiveCorruption: () => ipcRenderer.invoke(IPC_CHANNELS.archiveCorruption),
  },

  migration: {
    status: () => ipcRenderer.invoke(IPC_CHANNELS.migrationStatus),
    import: (request) => ipcRenderer.invoke(IPC_CHANNELS.migrationImport, request),
  },

  backup: {
    /**
     * Backup and restore of the whole workspace. Each method drives a native
     * dialog in the main process; `create` and `apply` carry their own payload,
     * while `inspect` takes none because the picker is opened on the far side.
     */
    create: (request) => ipcRenderer.invoke(IPC_CHANNELS.backupExport, request),
    inspect: () => ipcRenderer.invoke(IPC_CHANNELS.backupInspect),
    apply: (request) => ipcRenderer.invoke(IPC_CHANNELS.backupApply, request),
  },

  lifecycle: {
    /**
     * The only bridge method where main talks to the renderer rather than the
     * other way round. The `ipcRenderer` event object is swallowed and only the
     * (empty) payload is forwarded, so the renderer never gains a handle on the
     * emitter. Returning an unsubscribe keeps the renderer in control of when
     * it stops listening.
     */
    onFlushRequest: (handler) => {
      const listener = () => handler()

      ipcRenderer.on(IPC_CHANNELS.flushRequest, listener)

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.flushRequest, listener)
      }
    },
    reportFlushResult: (report) => ipcRenderer.invoke(IPC_CHANNELS.flushResult, report),
  },

  theme: {
    /**
     * Carries the app's theme preference to the main process, which mirrors it
     * onto the shell's native chrome (Chromium's context menu, colour scheme
     * and `prefers-color-scheme`). A one-way setter: the renderer owns the
     * choice, and nothing reads it back.
     */
    setSource: (request) => ipcRenderer.invoke(IPC_CHANNELS.themeSetSource, request),
  },

  windowControls: {
    /**
     * The three caption buttons the custom title bar draws in place of the
     * Windows caption the frameless window no longer has. Each takes no
     * arguments — the main process validates that. `close` goes through
     * `BrowserWindow.close()`, so it runs the same close handshake as Alt+F4
     * and the system close button.
     */
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.windowToggleMaximize),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.windowClose),

    /** The maximize state to paint the button with on the first render. */
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.windowState),

    /**
     * Main → renderer: the maximize state moved, from either side. The
     * `ipcRenderer` event object is swallowed (as `onFlushRequest` does) and
     * only the payload is forwarded, so the renderer never gains a handle on
     * the emitter; returning an unsubscribe keeps the renderer in control of
     * when it stops listening.
     */
    onMaximizedChanged: (handler) => {
      const listener = (_event: unknown, payload: WindowStateResult) => handler(payload)

      ipcRenderer.on(IPC_CHANNELS.windowMaximizedChanged, listener)

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.windowMaximizedChanged, listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('x31deskDesktop', bridge)