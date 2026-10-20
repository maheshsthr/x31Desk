/**
 * The theme actually applied to the document. Only ever a concrete light or
 * dark value: `system` is a preference, not a look (see {@link ThemePreference}).
 */
export type Theme = 'light' | 'dark'

/**
 * What the user chose in Settings. `system` follows the operating system and is
 * resolved to a concrete {@link Theme} before it reaches the document.
 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** Value of the `data-theme` attribute that carries the active theme. */
export const THEME_ATTRIBUTE = 'data-theme'

/** The product ships with the Nordic Blue light theme as the default. */
export const DEFAULT_THEME: Theme = 'light'

/** The preference the product starts from; kept in step with {@link DEFAULT_THEME}. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'light'

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

/**
 * Resolves a preference to the theme to apply. `system` defers to the OS, which
 * the caller reads from `prefers-color-scheme`.
 */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): Theme {
  if (preference === 'system') {
    return prefersDark ? 'dark' : 'light'
  }

  return preference
}
