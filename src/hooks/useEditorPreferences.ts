import { useSyncExternalStore } from 'react'

import { settingsStore } from '@/data/settingsStore'
import type { EditorPreferences } from '@/types/editorPreferences'

/**
 * Subscribes only to the editor slice of the settings store.
 *
 * The store keeps `editor` referentially stable across theme changes, so this
 * returns a cached value and re-renders the editor only when a preference that
 * actually affects it changed.
 */
function selectEditor() {
  return settingsStore.getSnapshot().editor
}

/** The live editor preferences, for the snippets code editor. */
export function useEditorPreferences(): EditorPreferences {
  return useSyncExternalStore(settingsStore.subscribe, selectEditor)
}
