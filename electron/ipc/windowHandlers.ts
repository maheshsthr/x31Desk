/**
 * x31Desk — the main process's window-control handlers.
 * ---------------------------------------------------------------------------
 * The application window is frameless (`frame: false` in `electron/main.ts`) so
 * the renderer can draw its own VS Code-style title bar. Everything the
 * operating system used to offer through the native caption — minimize,
 * maximize/restore, close, and the maximize state the button must display — is
 * published here instead, as five narrow channels:
 *
 *   * three validated actions that take **no arguments** (a malformed call
 *     throws, exactly like `appInfo`, rather than being tolerated);
 *   * one read of the current state, which the renderer asks once on mount;
 *   * one push the main process sends whenever the state moves, including
 *     moves the renderer did not initiate (snapping the window to a screen
 *     edge, the OS-side double-click on the drag region), so the title bar can
 *     never show a "maximize" glyph over a maximized window.
 *
 * Closing deliberately goes through `BrowserWindow.close()` and not
 * `destroy()`: that raises the window's `close` event, so the close handshake
 * flushes the renderer before the window goes — the title-bar close button and
 * Alt+F4 therefore share one path.
 *
 * The window is taken through a provider (typed structurally) rather than
 * imported at runtime, so this module is exercised against a stand-in under
 * plain Node, exactly like the repository and theme handlers.
 */

import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'

import { IPC_CHANNELS, type WindowStateResult } from '@/data/ipc/contract'

/**
 * The window operations the handlers drive.
 *
 * Structural on purpose: the handlers need only these five members, so a test
 * can pass a plain object and the module never has to pull `electron` into the
 * Node test process. `BrowserWindow` satisfies this shape.
 */
export type AppWindow = {
  isMaximized: () => boolean
  minimize: () => void
  maximize: () => void
  unmaximize: () => void
  close: () => void
}

/** The window-control handlers, taking the raw `invoke` arguments. */
export type WindowHandlers = {
  readonly minimize: (args: readonly unknown[]) => void
  readonly toggleMaximize: (args: readonly unknown[]) => void
  readonly close: (args: readonly unknown[]) => void
  readonly getState: (args: readonly unknown[]) => WindowStateResult
}

/**
 * Rejects any argument on a channel that takes none.
 *
 * The `appInfo` shape: a call that should be impossible fails loudly instead
 * of being silently tolerated, so a renderer bug surfaces at the call site.
 */
function requireNoArgs(channel: string, args: readonly unknown[]): void {
  if (args.length > 0) {
    throw new Error(`${channel} does not accept arguments`)
  }
}

/** Builds the window-control handlers around a provider for the live window. */
export function createWindowHandlers(getWindow: () => AppWindow | null): WindowHandlers {
  return {
    minimize: (args) => {
      requireNoArgs(IPC_CHANNELS.windowMinimize, args)
      getWindow()?.minimize()
    },

    toggleMaximize: (args) => {
      requireNoArgs(IPC_CHANNELS.windowToggleMaximize, args)

      const window = getWindow()
      if (window === null) {
        return
      }

      if (window.isMaximized()) {
        window.unmaximize()
      } else {
        window.maximize()
      }
    },

    close: (args) => {
      requireNoArgs(IPC_CHANNELS.windowClose, args)
      // `close()`, not `destroy()`: the window's `close` event runs the close
      // handshake, so the renderer flushes before the window goes.
      getWindow()?.close()
    },

    getState: (args) => {
      requireNoArgs(IPC_CHANNELS.windowState, args)
      return { maximized: getWindow()?.isMaximized() ?? false }
    },
  }
}

/**
 * Registers the four invoke channels on the given `ipcMain`.
 *
 * Registration is window-independent — the provider is read per call — so the
 * handlers can be registered before the window exists, exactly like the
 * backup dialogs.
 */
export function registerWindowHandlers(
  ipcMain: IpcMain,
  getWindow: () => AppWindow | null,
): void {
  const handlers = createWindowHandlers(getWindow)

  ipcMain.handle(IPC_CHANNELS.windowMinimize, (_event: IpcMainInvokeEvent, ...args: unknown[]) =>
    handlers.minimize(args),
  )
  ipcMain.handle(IPC_CHANNELS.windowToggleMaximize, (_event: IpcMainInvokeEvent, ...args: unknown[]) =>
    handlers.toggleMaximize(args),
  )
  ipcMain.handle(IPC_CHANNELS.windowClose, (_event: IpcMainInvokeEvent, ...args: unknown[]) =>
    handlers.close(args),
  )
  ipcMain.handle(IPC_CHANNELS.windowState, (_event: IpcMainInvokeEvent, ...args: unknown[]) =>
    handlers.getState(args),
  )
}

/**
 * The window pieces state publication needs: the two events that move the
 * maximize state, and the renderer to push to.
 *
 * `Pick` of Electron's own `BrowserWindow` rather than a hand-written shape,
 * because `on` is heavily overloaded and a structural stand-in for it would be
 * a lie; the type import is erased at build time, so the module still runs
 * against a plain fake under Node.
 */
export type StatePublishingWindow = Pick<BrowserWindow, 'on' | 'removeListener' | 'webContents'>

/**
 * Pushes every maximize-state movement to the renderer, and returns the
 * unsubscribe so the caller can detach on the way out.
 *
 * The event itself carries the new value (`maximize` → true, `unmaximize` →
 * false), so the push never races a concurrent `isMaximized()` read. Both
 * directions are wired because either can be triggered from outside the
 * renderer — the button is only one of the ways a window is maximized.
 */
export function wireWindowState(window: StatePublishingWindow): () => void {
  const publish = (maximized: boolean) => () => {
    window.webContents.send(IPC_CHANNELS.windowMaximizedChanged, { maximized })
  }

  const onMaximize = publish(true)
  const onUnmaximize = publish(false)

  window.on('maximize', onMaximize)
  window.on('unmaximize', onUnmaximize)

  return () => {
    window.removeListener('maximize', onMaximize)
    window.removeListener('unmaximize', onUnmaximize)
  }
}
