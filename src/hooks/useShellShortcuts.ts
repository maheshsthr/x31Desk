import { useEffect, useRef } from 'react'

import { saveQueue } from '@/data/saveQueue'
import { getLastStorageErrorKind, storageErrorMessage } from '@/data/storageError'
import { useToast } from '@/hooks/useToast'
import { requestIntent } from '@/navigation/intent'
import { resolveShellShortcut, type ShellShortcutAction } from '@/shortcuts/shortcuts'
import type { ViewId } from '@/types/navigation'

type ShellShortcutsOptions = {
  /** The view showing, so `Ctrl+N` creates what this section holds. */
  activeView: ViewId
  /** Switches the active view. */
  onNavigate: (view: ViewId) => void
}

/**
 * The one listener behind every shell-owned shortcut: section navigation
 * (`Ctrl+1`…`Ctrl+6`), create (`Ctrl+N`), save (`Ctrl+S`), rename (`F2`) and
 * refresh (`F5`).
 *
 * The mapping itself lives in `@/shortcuts/shortcuts` — this hook only turns
 * the resolved action into effect. Keeping a single `keydown` listener for the
 * whole shell is what makes "one keystroke, one action" structural rather than
 * a convention: there is no second shell listener to race it, and the
 * component-owned keys (`Ctrl+K`, `/`, `Ctrl+Shift+C`, `Esc`) are disjoint
 * from these, which the tests pin.
 *
 * Every shell binding is a modifier combination or a function key, so the
 * layer fires from inside fields and CodeMirror without swallowing a
 * character — a deliberate, safe global action. What it never does is run
 * behind a modal dialog: `resolveShellShortcut` stands navigation, creation
 * and renaming down while one is open, so a half-filled form cannot be
 * discarded by a keystroke the user aimed elsewhere.
 */
export function useShellShortcuts({ activeView, onNavigate }: ShellShortcutsOptions): void {
  const { notify } = useToast()

  // The listener outlives renders; the latest view and callback are read
  // through refs so a keystroke always acts on current state without
  // re-subscribing on every render.
  const activeViewRef = useRef(activeView)
  const onNavigateRef = useRef(onNavigate)

  useEffect(() => {
    activeViewRef.current = activeView
    onNavigateRef.current = onNavigate
  }, [activeView, onNavigate])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveShellShortcut(event, {
        activeView: activeViewRef.current,
        dialogOpen: document.querySelector('dialog[open]') !== null,
        hasRenameTarget: document.querySelector('[data-rename-target]') !== null,
      })

      if (action === null) {
        return
      }

      // The keystroke is consumed here: the browser's own `Ctrl+S` save
      // dialog, its `F5` reload and — where a browser lets a page win —
      // `Ctrl+number` tab switching must not race the application's handling
      // of the same key.
      event.preventDefault()

      performShellAction(action, { onNavigate: onNavigateRef.current, notify })
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [notify])
}

/** What performing a shell action needs from whoever asks for it. */
export type ShellActionContext = {
  /** Switches the active view. */
  onNavigate: (view: ViewId) => void
  /** Reports a completed save; used by the save action. */
  notify: (message: string) => void
}

/**
 * Turns one resolved shell action into effect.
 *
 * The single implementation behind both inputs of the shortcut system: the
 * window `keydown` listener and the custom title bar's menus, so choosing
 * "New Task" from File can never drift from what `Ctrl+N` does in the Tasks
 * view. Kept in the hook module on purpose — it is the same layer, reached by
 * a second trigger rather than a second copy of the behaviour.
 *
 * Actions arrive already resolved (a keystroke through `resolveShellShortcut`,
 * or verbatim from the menu definitions), so the dialog stand-down has already
 * happened by the time this runs; the title bar cannot be clicked while a
 * modal `<dialog>` holds the page inert anyway.
 */
export function performShellAction(action: ShellShortcutAction, context: ShellActionContext): void {
  const { onNavigate, notify } = context

  switch (action.type) {
    case 'navigate':
      onNavigate(action.view)
      break
    case 'new-item':
      // The same "go there and do something" hand-off the dashboard's
      // quick actions use: the destination creates the item as it
      // arrives, or immediately when it is already the open view.
      requestIntent(action.intent)
      onNavigate(action.view)
      break
    case 'save':
      flushPendingChanges(notify)
      break
    case 'rename': {
      const target = document.querySelector<HTMLInputElement>('[data-rename-target]')
      target?.focus()
      target?.select()
      break
    }
    case 'refresh':
      // A reload must not lose a draft still sitting in a debounce timer,
      // so the queue drains first. A failed write has already reported
      // itself through the storage layer; the refresh is what was asked
      // for either way.
      void saveQueue
        .flushAll()
        .catch(() => undefined)
        .finally(() => window.location.reload())
      break
  }
}

/**
 * Pulls every debounced write forward now.
 *
 * Autosave already carries each draft as it is typed — this only makes the
 * pending writes land immediately, which is what "save" should mean in an app
 * that autosaves, and never replaces or delays the autosave itself. With
 * nothing scheduled it is a silent no-op, so the shortcut never interrupts
 * typing to announce that there was nothing to save.
 */
function flushPendingChanges(notify: (message: string) => void): void {
  if (!saveQueue.hasWork()) {
    return
  }

  void saveQueue
    .flushAll()
    .then(() => notify('All changes saved.'))
    .catch(() =>
      notify(storageErrorMessage(getLastStorageErrorKind(), 'Changes could not be saved.')),
    )
}
