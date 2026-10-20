import { subscribeToStorageKeys } from '@/data/crossTabSync'
import { STORAGE_KEYS } from '@/data/storageKeys'
import {
  DEFAULT_EDITOR_PREFERENCES,
  sanitizeEditorPreferences,
  type EditorPreferences,
} from '@/types/editorPreferences'
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_ATTRIBUTE,
  isThemePreference,
  resolveTheme,
  type Theme,
  type ThemePreference,
} from '@/types/theme'

/**
 * What a subscriber sees. A single immutable object so `useSyncExternalStore`
 * can compare snapshots by identity and only re-render when something actually
 * changed. `editor` keeps its identity across theme changes and vice versa, so
 * the code editor is not rebuilt when only the theme moves.
 */
export type SettingsSnapshot = {
  themePreference: ThemePreference
  /** The theme actually applied to the document. */
  resolvedTheme: Theme
  editor: EditorPreferences
}

/**
 * The application's preferences, in one place.
 *
 * Theme used to live in `useTheme`, owned by the app root. It could not stay
 * there: the top bar's toggle and the Settings page must never disagree, and a
 * single module-level store is what guarantees that, exactly as `taskStore`
 * does for tasks. Editor preferences ride along because they are the same kind
 * of value — a user choice that outlives navigation and reloads.
 *
 * Persistence is deliberately separate from the notes, tasks, snippets and
 * archive keys, so "clear workspace data" can wipe the content without touching
 * a single preference.
 */
export type SettingsStore = {
  /** `useSyncExternalStore` contract: subscribe, and unsubscribe on return. */
  subscribe: (listener: () => void) => () => void
  /** `useSyncExternalStore` contract: a cached, referentially stable value. */
  getSnapshot: () => SettingsSnapshot
  /** Chooses light, dark, or following the operating system. */
  setThemePreference: (preference: ThemePreference) => void
  /** Flips to the opposite *applied* theme, as an explicit choice. */
  toggleTheme: () => void
  /** Applies a partial editor change; unspecified fields are kept. */
  updateEditorPreferences: (patch: Partial<EditorPreferences>) => void
}

const THEME_STORAGE_KEY = STORAGE_KEYS.theme
const EDITOR_STORAGE_KEY = STORAGE_KEYS.editor
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

/** Reads the persisted theme preference, falling back to the product default. */
function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE
  } catch {
    // Storage can be unavailable (private mode, locked profile); default is fine.
    return DEFAULT_THEME_PREFERENCE
  }
}

/** Whether the operating system currently asks for a dark appearance. */
function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK_SCHEME_QUERY).matches
  } catch {
    // No `matchMedia` (or a locked-down environment): light is the default.
    return false
  }
}

/** Reads the persisted editor preferences, coercing anything unusable. */
function readEditorPreferences(): EditorPreferences {
  try {
    const raw = window.localStorage.getItem(EDITOR_STORAGE_KEY)

    if (raw === null || raw === '') {
      return DEFAULT_EDITOR_PREFERENCES
    }

    return sanitizeEditorPreferences(JSON.parse(raw) as unknown)
  } catch {
    // Missing, malformed or unreadable: the shipped defaults are the safe value.
    return DEFAULT_EDITOR_PREFERENCES
  }
}

/** Whether two editor-preference values are equivalent field by field. */
function sameEditorPreferences(a: EditorPreferences, b: EditorPreferences): boolean {
  return (
    a.fontSize === b.fontSize &&
    a.fontWeight === b.fontWeight &&
    a.lineNumbers === b.lineNumbers &&
    a.activeLine === b.activeLine &&
    a.bracketMatching === b.bracketMatching
  )
}

/** Builds a store over the browser's storage. Exported for tests. */
export function createSettingsStore(): SettingsStore {
  const listeners = new Set<() => void>()

  let preference = readThemePreference()
  let editor = readEditorPreferences()

  let snapshot: SettingsSnapshot = {
    themePreference: preference,
    resolvedTheme: resolveTheme(preference, systemPrefersDark()),
    editor,
  }

  function emit(next: SettingsSnapshot): void {
    snapshot = next

    for (const listener of listeners) {
      listener()
    }
  }

  function applyTheme(theme: Theme): void {
    try {
      document.documentElement.setAttribute(THEME_ATTRIBUTE, theme)
    } catch {
      // No document to theme (a non-DOM environment); the choice still holds.
    }
  }

  function persistTheme(next: ThemePreference): void {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Persistence is a convenience, not a requirement.
    }
  }

  function persistEditor(next: EditorPreferences): void {
    try {
      window.localStorage.setItem(EDITOR_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Persistence is a convenience, not a requirement.
    }
  }

  /** Set while another tab's change to a preference is being folded in. */
  let unsubscribeCrossTab: (() => void) | null = null

  /**
   * Folds in a preference another tab just changed, without disturbing the other
   * slices: `editor` keeps its identity across a theme-only change (and vice
   * versa), so the code editor is not rebuilt for a change that does not affect
   * it. Emits only when something actually moved, which keeps a redundant event
   * from re-rendering the whole application.
   */
  function syncFromStorage(): void {
    const nextPreference = readThemePreference()
    const nextEditor = readEditorPreferences()

    let changed = false

    if (nextPreference !== preference) {
      preference = nextPreference
      changed = true
    }

    if (!sameEditorPreferences(nextEditor, editor)) {
      editor = nextEditor
      changed = true
    }

    if (!changed) {
      return
    }

    const resolved = resolveTheme(preference, systemPrefersDark())
    applyTheme(resolved)
    emit({ themePreference: preference, resolvedTheme: resolved, editor })
  }

  // Apply the stored theme as soon as the store exists — before the first
  // render — so a dark workspace does not flash the light tokens on load.
  applyTheme(snapshot.resolvedTheme)

  // While the preference is `system`, follow the OS live. The listener lives for
  // the life of the application; the store is a singleton.
  try {
    window.matchMedia(DARK_SCHEME_QUERY).addEventListener('change', (event) => {
      if (preference !== 'system') {
        return
      }

      const resolved = resolveTheme('system', event.matches)
      applyTheme(resolved)
      emit({ ...snapshot, resolvedTheme: resolved })
    })
  } catch {
    // Without `matchMedia` the preference still works; it just will not react to
    // the OS changing under a running window.
  }

  return {
    subscribe(listener) {
      listeners.add(listener)

      // Watch for another tab changing a preference only while someone is
      // actually listening, so a store created in a test or a non-DOM process
      // attaches nothing.
      if (listeners.size === 1) {
        unsubscribeCrossTab = subscribeToStorageKeys(
          [STORAGE_KEYS.theme, STORAGE_KEYS.editor],
          syncFromStorage,
        )
      }

      return () => {
        listeners.delete(listener)

        if (listeners.size === 0) {
          unsubscribeCrossTab?.()
          unsubscribeCrossTab = null
        }
      }
    },

    getSnapshot() {
      return snapshot
    },

    setThemePreference(next) {
      if (!isThemePreference(next)) {
        return
      }

      preference = next

      const resolved = resolveTheme(next, systemPrefersDark())
      persistTheme(next)
      applyTheme(resolved)
      emit({ ...snapshot, themePreference: next, resolvedTheme: resolved })
    },

    toggleTheme() {
      // From `system`, this pins the opposite of what the user is currently
      // looking at as an explicit choice; from light/dark it simply flips.
      const next: ThemePreference = snapshot.resolvedTheme === 'dark' ? 'light' : 'dark'

      preference = next
      persistTheme(next)
      applyTheme(next)
      emit({ ...snapshot, themePreference: next, resolvedTheme: next })
    },

    updateEditorPreferences(patch) {
      const next = sanitizeEditorPreferences({ ...editor, ...patch })

      editor = next
      persistEditor(next)
      emit({ ...snapshot, editor: next })
    },
  }
}

/** The store the application uses. */
export const settingsStore: SettingsStore = createSettingsStore()
