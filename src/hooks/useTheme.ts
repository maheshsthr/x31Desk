import { useSyncExternalStore } from 'react'

import { settingsStore } from '@/data/settingsStore'
import type { Theme, ThemePreference } from '@/types/theme'

type ThemeApi = {
  /** The theme actually applied to the document. */
  theme: Theme
  /** The stored choice, including `system`. */
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
  /** Flips to the opposite applied theme as an explicit choice. */
  toggleTheme: () => void
}

/**
 * The active theme and how to change it.
 *
 * A thin view over the shared settings store: the top bar's toggle and the
 * Settings page read the same state, so they stay synchronized without prop
 * drilling or a second copy of the theme.
 */
export function useTheme(): ThemeApi {
  const snapshot = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)

  return {
    theme: snapshot.resolvedTheme,
    preference: snapshot.themePreference,
    setPreference: settingsStore.setThemePreference,
    toggleTheme: settingsStore.toggleTheme,
  }
}
