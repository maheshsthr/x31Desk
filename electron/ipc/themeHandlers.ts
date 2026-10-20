/**
 * x31Desk — the main process's native-chrome theme handler.
 * ---------------------------------------------------------------------------
 * One channel: the shell's native theme source, which is what colours the
 * Windows title bar. It is not a repository operation — no `Repository` method
 * reads it back — so it lives apart from `repositoryHandlers.ts` and is
 * registered by its own function, exactly like the migration and recovery
 * handlers.
 *
 * On Windows the standard (non-client) frame — the title bar and its system
 * buttons — is drawn by the Desktop Window Manager, not by any renderer CSS. The
 * supported way for an Electron app to choose its colour is
 * `nativeTheme.themeSource`: Chromium applies `DWMWA_USE_IMMERSIVE_DARK_MODE` to
 * each window from it (`shell/browser/win/dark_mode.cc`), so `light`/`dark` pins
 * the frame to that appearance and `system` defers to the OS. An explicit choice
 * therefore wins even when Windows itself prefers the opposite, which is what
 * makes the app's theme (not the OS's) decide the bar.
 *
 * The values the contract carries ({@link ThemePreference}) are exactly the three
 * `nativeTheme.themeSource` accepts, so this handler is a validated assignment
 * and nothing more. An argument that fails validation is rejected — the title bar
 * is left untouched rather than set to an arbitrary value — and the failure is
 * returned in the storage-error vocabulary the renderer already understands.
 *
 * The Electron `nativeTheme` object is taken as a parameter (typed structurally)
 * rather than imported at runtime, so the handler is exercised against a
 * stand-in under plain Node, exactly like the repository handlers.
 */

import type { IpcMain, IpcMainInvokeEvent } from 'electron'

import { IPC_CHANNELS, type IpcResult } from '@/data/ipc/contract'
import type { ThemePreference } from '@/types/theme'

import { parseThemeSource } from './validation.ts'

/**
 * The slice of Electron's `nativeTheme` this handler drives.
 *
 * Structural on purpose: the handler needs only the settable `themeSource`, so a
 * test can pass a plain object and the module never has to pull `electron` into
 * the Node test process.
 */
export type NativeThemeSource = {
  themeSource: ThemePreference
}

/** The theme handler, taking the raw `invoke` arguments. */
export type ThemeHandlers = {
  readonly setSource: (args: readonly unknown[]) => IpcResult<void>
}

/** Builds the theme handler around a settable native theme source. */
export function createThemeHandlers(nativeTheme: NativeThemeSource): ThemeHandlers {
  function setSource(args: readonly unknown[]): IpcResult<void> {
    if (args.length !== 1) {
      console.error(
        `[x31desk] rejected ${IPC_CHANNELS.themeSetSource}: expected one argument, received ${args.length}`,
      )

      return { ok: false, kind: 'unknown' }
    }

    const input = parseThemeSource(args[0])

    if (input === null) {
      console.error(
        `[x31desk] rejected ${IPC_CHANNELS.themeSetSource}: payload failed validation`,
      )

      return { ok: false, kind: 'unknown' }
    }

    nativeTheme.themeSource = input.preference

    return { ok: true, value: undefined }
  }

  return { setSource }
}

/**
 * Registers the theme handler on the given `ipcMain`, writing to the supplied
 * native theme source.
 */
export function registerThemeHandlers(ipcMain: IpcMain, nativeTheme: NativeThemeSource): void {
  const handlers = createThemeHandlers(nativeTheme)

  ipcMain.handle(IPC_CHANNELS.themeSetSource, (_event: IpcMainInvokeEvent, ...args: unknown[]) =>
    handlers.setSource(args),
  )
}
