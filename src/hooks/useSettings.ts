import { useSyncExternalStore } from 'react'

import { settingsStore } from '@/data/settingsStore'

/**
 * The Settings page API: the shared preference snapshot plus every mutation.
 *
 * Reads the same module-level store the top-bar theme toggle writes to, so the
 * two can never hold divergent copies — picking "Dark" in Settings updates the
 * toggle immediately, and vice versa.
 */
export function useSettings() {
  const snapshot = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)

  return {
    themePreference: snapshot.themePreference,
    resolvedTheme: snapshot.resolvedTheme,
    editor: snapshot.editor,
    setThemePreference: settingsStore.setThemePreference,
    toggleTheme: settingsStore.toggleTheme,
    updateEditorPreferences: settingsStore.updateEditorPreferences,
  }
}
