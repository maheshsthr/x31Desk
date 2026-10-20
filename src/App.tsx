import { useState } from 'react'

import { ToastProvider } from '@/components/ui/ToastProvider'
import { AppShell } from '@/layouts/AppShell'
import { DEFAULT_VIEW } from '@/navigation/navigation'
import type { ViewId } from '@/types/navigation'

/**
 * Application root. Owns the one piece of state that is global to the shell:
 * the active view. The theme lives in the shared settings store, which the top
 * bar and the Settings page both read, so it is not threaded through here.
 */
export default function App() {
  const [activeView, setActiveView] = useState<ViewId>(DEFAULT_VIEW)

  return (
    <ToastProvider>
      <AppShell activeView={activeView} onNavigate={setActiveView} />
    </ToastProvider>
  )
}
