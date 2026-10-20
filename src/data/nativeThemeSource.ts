/**
 * x31Desk — the renderer's half of native-chrome theming.
 * ---------------------------------------------------------------------------
 * The application's theme lives in the renderer (`settingsStore`), but the
 * Windows title bar is drawn by the operating system, on the main-process side.
 * This module is the one place the two meet: it hands the stored theme
 * preference to the main process and keeps it in step whenever the preference
 * changes, so switching theme in Settings recolours the title bar immediately.
 *
 * The *preference* is what travels, not the resolved theme, because the two
 * cases are genuinely different:
 *
 *   * `light` / `dark` pin the native title bar to that appearance, so an
 *     explicit choice is honoured even when Windows itself prefers the other.
 *   * `system` hands the OS back its own decision, so the title bar follows
 *     Windows exactly as the application does.
 *
 * It is installed once, from `src/main.tsx`, before the first render — the
 * preference is read synchronously, so the title bar is set as early as the
 * renderer can speak. A plain browser has no bridge, so installation is a no-op
 * there and returns a usable unsubscribe. Everything is injectable, so the
 * behaviour can be driven directly in a test without Electron, React or a DOM.
 */

import { settingsStore } from '@/data/settingsStore'
import type { DesktopThemeBridge } from '@/types/desktop'
import type { ThemePreference } from '@/types/theme'

/**
 * The slice of the settings store this module reads: the current theme
 * preference and a way to hear about the next one. Structural, so a test can
 * pass a stand-in rather than the real singleton.
 */
export type ThemePreferenceStore = {
  readonly getSnapshot: () => { readonly themePreference: ThemePreference }
  readonly subscribe: (listener: () => void) => () => void
}

/** Options for {@link installNativeThemeSource}, all injectable for tests. */
export type NativeThemeSourceOptions = {
  /** The bridge to use; defaults to `window.x31deskDesktop?.theme`. */
  readonly bridge?: DesktopThemeBridge
  /** The store to read; defaults to the shared settings store. */
  readonly store?: ThemePreferenceStore
  /** Called when a report to the main process fails, so a caller can log it. */
  readonly onError?: (error: unknown) => void
}

/** The theme bridge, when the renderer is running inside Electron. */
function desktopTheme(): DesktopThemeBridge | undefined {
  return window.x31deskDesktop?.theme
}

/**
 * Starts mirroring the app's theme preference onto the shell's native title bar
 * and returns the unsubscribe.
 *
 * Returns a no-op unsubscribe in a browser, so a caller installs it
 * unconditionally. The current preference is sent synchronously on install, so
 * the persisted choice is applied on startup as well as on every later change.
 */
export function installNativeThemeSource(options: NativeThemeSourceOptions = {}): () => void {
  const bridge = options.bridge ?? desktopTheme()

  if (bridge === undefined) {
    return () => {}
  }

  const store = options.store ?? settingsStore

  // The preference last handed to the main process. An emit that does not move
  // the preference — an editor tweak, a re-render — is not reported again, so the
  // title bar is touched only when the theme actually changes.
  let reported: ThemePreference | null = null

  const report = (preference: ThemePreference): void => {
    if (preference === reported) {
      return
    }

    reported = preference

    bridge.setSource({ preference }).then(
      (result) => {
        // A rejected caller is corrected by the next change; a failure response
        // is reported rather than swallowed, so a broken bridge is visible.
        if (!result.ok) {
          options.onError?.(new Error(`native theme source rejected: ${result.kind}`))
        }
      },
      (error: unknown) => {
        options.onError?.(error)
      },
    )
  }

  report(store.getSnapshot().themePreference)

  return store.subscribe(() => {
    report(store.getSnapshot().themePreference)
  })
}
