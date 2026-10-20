import { useEffect, useRef } from 'react'

import { isTypingTarget, matchesShortcut } from '@/shortcuts/shortcuts'

type KeyboardShortcutOptions = {
  /** Requires Ctrl (Windows/Linux) or Cmd (macOS). */
  ctrlOrMeta?: boolean
  shift?: boolean
  alt?: boolean
  /** Lets callers disable the shortcut, e.g. while a dialog is open. */
  enabled?: boolean
  /**
   * Stands the shortcut down while the user is typing into a field, so a bare
   * key such as `/` reaches the field instead of being captured. Modifier
   * shortcuts leave this off: `Ctrl+K` and friends are safe to fire from a
   * field, and the editor keeps its own key map for anything it binds.
   */
  ignoreWhileTyping?: boolean
  /**
   * Whether the shortcut swallows the key's default action. Defaults to `true`;
   * turn it off for keys whose browser behaviour is still wanted — `Esc` must
   * stay free to close a native `<dialog>` even while a toast is visible.
   */
  preventDefault?: boolean
}

/**
 * Binds a keyboard shortcut to the window while the calling component is
 * mounted.
 *
 * The handler is kept in a ref so callers can pass an inline arrow function
 * without re-subscribing the listener on every render. Matching itself is the
 * one implementation in `@/shortcuts/shortcuts`, so this hook and the shell's
 * central dispatcher agree on what `Ctrl+Shift+C` means.
 */
export function useKeyboardShortcut(
  key: string,
  options: KeyboardShortcutOptions,
  handler: () => void,
): void {
  const {
    ctrlOrMeta = false,
    shift = false,
    alt = false,
    enabled = true,
    ignoreWhileTyping = false,
    preventDefault = true,
  } = options

  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, { key, ctrl: ctrlOrMeta, shift, alt })) {
        return
      }

      if (ignoreWhileTyping && isTypingTarget(event.target)) {
        return
      }

      if (preventDefault) {
        event.preventDefault()
      }

      handlerRef.current()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [key, ctrlOrMeta, shift, alt, enabled, ignoreWhileTyping, preventDefault])
}
