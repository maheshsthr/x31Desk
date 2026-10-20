import { Info, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'

import { ToastContext, type ToastApi } from '@/hooks/useToast'
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut'

type Toast = {
  id: number
  message: string
}

const AUTO_DISMISS_MS = 3400

type ToastItemProps = {
  toast: Toast
  onDismiss: (id: number) => void
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  return (
    <div className="animate-toast-in pointer-events-auto flex items-start gap-2 rounded-sm border border-line bg-surface px-3 py-2 shadow-floating">
      <Info aria-hidden className="mt-px size-3.5 shrink-0 text-accent" strokeWidth={2} />
      <p className="flex-1 text-xs text-ink">{toast.message}</p>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        className="-m-1 shrink-0 rounded-xs p-1 text-ink-muted transition-colors duration-150 ease-standard hover:text-ink"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  )
}

/**
 * Hosts transient notifications at the application root.
 *
 * Feature-complete areas arrive in later phases, so controls that cannot do
 * their real job yet acknowledge the click with a short message instead of
 * silently doing nothing. State is intentionally local: notifications are
 * ephemeral UI, never persisted.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback((message: string) => {
    const id = nextId.current++
    setToasts((current) => [...current, { id, message }])

    // Timers only clear UI state, so firing after unmount is harmless.
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, AUTO_DISMISS_MS)
  }, [])

  const api = useMemo<ToastApi>(() => ({ notify }), [notify])

  // `Esc` also sweeps away notifications, but it must not swallow the key: the
  // default action is what closes an open native `<dialog>`, and a toast on
  // screen should never stop a confirmation dialog from dismissing. While a
  // dialog is open the keystroke belongs to it, so the sweep stands down rather
  // than clearing notifications out from under the dialog.
  useKeyboardShortcut('Escape', { enabled: toasts.length > 0, preventDefault: false }, () => {
    if (document.querySelector('dialog[open]') !== null) {
      return
    }

    setToasts([])
  })

  return (
    <ToastContext.Provider value={api}>
      {children}

      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-72 flex-col gap-2"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
