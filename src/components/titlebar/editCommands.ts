// x31Desk — the custom title bar's Edit menu actions.
// ---------------------------------------------------------------------------
// The Edit menu runs standard editing operations through
// `document.execCommand`, which acts on whatever editable element holds focus
// — a note title, a task form field, CodeMirror's content surface. Three
// policies make that dependable rather than lucky:
//
//   * **Focus is never moved by the menu itself.** The menu's triggers and
//     rows suppress the default `mousedown` behaviour, so opening a menu or
//     clicking a row cannot pull focus out of the field being edited.
//   * **Focus is remembered, not assumed.** Clicking the menu button suppresses
//     `mousedown` so focus stays where it was, and keyboard users can still
//     reach the rows by tabbing; `installEditableFocusTracking` remembers the
//     last element the user typed into, so a row can put focus back before it
//     acts even when a button has taken it in the meantime.
//   * **Nothing editable means nothing happens.** `execCommand` against the
//     document with no target can produce surprising results, so a command
//     with no editable target returns `false` instead of running blind.
//
// Paste is deliberately absent from the menu (see `titleBarMenus.ts`):
// Chromium blocks `document.execCommand('paste')` in renderer content.
import { isTypingTarget } from '@/shortcuts/shortcuts'

/** The editor operations the Edit menu runs on the focused field. */
export type EditCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'selectAll'

/** The document surface these functions need; `document` in a real app. */
export type EditableDocument = {
  activeElement: EventTarget | null
  execCommand: (command: string, showUI?: boolean, value?: string) => boolean
  addEventListener: (type: string, listener: (event: Event) => void) => void
  removeEventListener: (type: string, listener: (event: Event) => void) => void
}

let lastFocusedEditable: EventTarget | null = null

/**
 * Remembers the element the user was last typing into.
 *
 * Installed once by the title bar for as long as it is mounted. `focusin`
 * fires for every focus move, so the newest editable target is always the one
 * the remembered value holds; a non-editable target (a menu row, a button)
 * does not overwrite it.
 *
 * Returns the unsubscribe, so the listener's lifetime matches the bar's.
 */
export function installEditableFocusTracking(
  doc: EditableDocument = document,
): () => void {
  const onFocusIn = (event: Event) => {
    if (isTypingTarget(event.target)) {
      lastFocusedEditable = event.target
    }
  }

  doc.addEventListener('focusin', onFocusIn)

  return () => {
    doc.removeEventListener('focusin', onFocusIn)
    lastFocusedEditable = null
  }
}

/**
 * Runs one editing command against the best target available.
 *
 * The active element wins while it is somewhere the user types; otherwise the
 * last remembered editable element is focused first (so the command lands in
 * the field it was aimed at, even after a keyboard-driven menu visit). With no
 * target at all the command does not run and `false` is returned — the same
 * answer the field itself would have given for a command with nothing to act
 * on.
 */
export function runEditCommand(
  command: EditCommand,
  doc: EditableDocument = document,
): boolean {
  let target = doc.activeElement

  if (!isTypingTarget(target) && isTypingTarget(lastFocusedEditable)) {
    target = lastFocusedEditable
    ;(target as { focus?: () => void } | null)?.focus?.()
  }

  if (!isTypingTarget(target)) {
    return false
  }

  return doc.execCommand(command)
}
