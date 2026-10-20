/**
 * Editor preferences.
 * ---------------------------------------------------------------------------
 * The subset of the snippets editor the Settings page exposes. Everything here
 * maps onto the existing CodeMirror configuration — no second editor — and is
 * persisted separately from notes, tasks, snippets and the archive.
 */

/** JetBrains Mono weights the application ships, by design-token name. */
export type EditorFontWeight = 'normal' | 'medium' | 'semibold'

export type EditorPreferences = {
  /** Code text size in pixels. */
  fontSize: number
  fontWeight: EditorFontWeight
  /** Whether the gutter shows line numbers. */
  lineNumbers: boolean
  /** Whether the current line is highlighted in the content and the gutter. */
  activeLine: boolean
  /** Whether matching brackets are highlighted as the caret sits beside them. */
  bracketMatching: boolean
}

export const EDITOR_FONT_SIZE_MIN = 12
export const EDITOR_FONT_SIZE_MAX = 20

/** Every size the picker offers, ascending. */
export const EDITOR_FONT_SIZES: readonly number[] = Array.from(
  { length: EDITOR_FONT_SIZE_MAX - EDITOR_FONT_SIZE_MIN + 1 },
  (_, index) => EDITOR_FONT_SIZE_MIN + index,
)

/** Weight choices, in presentation order, with their menu labels. */
export const EDITOR_FONT_WEIGHTS: readonly { value: EditorFontWeight; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'medium', label: 'Medium' },
  { value: 'semibold', label: 'Semibold' },
]

/**
 * The editor's shipped configuration: the size and weight it has always used
 * (`--x31-font-size-xs` and `--x31-font-weight-medium`) and every decoration on.
 */
export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  fontSize: 12,
  fontWeight: 'medium',
  lineNumbers: true,
  activeLine: true,
  bracketMatching: true,
}

function isEditorFontWeight(value: unknown): value is EditorFontWeight {
  return value === 'normal' || value === 'medium' || value === 'semibold'
}

function readFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_EDITOR_PREFERENCES.fontSize
  }

  const size = Math.round(value)

  return size < EDITOR_FONT_SIZE_MIN || size > EDITOR_FONT_SIZE_MAX
    ? DEFAULT_EDITOR_PREFERENCES.fontSize
    : size
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Coerces whatever was stored into usable preferences.
 *
 * Each field falls back to its default independently, so a single bad value —
 * a size out of range, a weight that no longer exists — never discards the
 * rest of the user's choices.
 */
export function sanitizeEditorPreferences(value: unknown): EditorPreferences {
  const candidate: Record<string, unknown> =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

  return {
    fontSize: readFontSize(candidate.fontSize),
    fontWeight: isEditorFontWeight(candidate.fontWeight)
      ? candidate.fontWeight
      : DEFAULT_EDITOR_PREFERENCES.fontWeight,
    lineNumbers: readBoolean(candidate.lineNumbers, DEFAULT_EDITOR_PREFERENCES.lineNumbers),
    activeLine: readBoolean(candidate.activeLine, DEFAULT_EDITOR_PREFERENCES.activeLine),
    bracketMatching: readBoolean(
      candidate.bracketMatching,
      DEFAULT_EDITOR_PREFERENCES.bracketMatching,
    ),
  }
}
