import { createContext, useContext } from 'react'

/** Imperative API exposed by the notification provider. */
export type ToastApi = {
  /**
   * Shows a transient message. Used to acknowledge interactions whose feature
   * is not implemented yet instead of leaving a control unresponsive.
   */
  notify: (message: string) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

/** Accesses the notification API; must be called under `<ToastProvider>`. */
export function useToast(): ToastApi {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>')
  }

  return context
}
