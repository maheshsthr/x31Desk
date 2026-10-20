import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted variable fonts (bundled by Vite as local assets) so the packaged
// desktop application renders correctly without any network access.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'

import { installCloseHandshake } from '@/data/closeHandshake'
import { installNativeThemeSource } from '@/data/nativeThemeSource'
import { ensureWorkspaceSchema } from '@/data/schema'

import './styles/globals.css'
import { Startup } from './Startup.tsx'

const container = document.getElementById('root')

if (!container) {
  throw new Error('x31Desk could not start: #root container is missing from index.html')
}

const root = container

// Bring the stored workspace up to the current schema before any collection is
// read. A no-op today (version 1); this is the hook future migrations run from.
// In the desktop shell this settles the `localStorage` shape the one-time import
// reads; it never touches the database.
ensureWorkspaceSchema()

// Answer the main process's close handshake as early as possible, so a close
// during startup still flushes (there is simply nothing to flush yet). A no-op
// in a plain browser, where the bridge is absent.
installCloseHandshake()

// Mirror the stored theme preference onto the shell's native title bar. Read
// synchronously, before the first render, so the title bar reflects the
// persisted light/dark choice from the moment the window appears — including
// when it differs from the operating system's. A no-op in a plain browser.
installNativeThemeSource()

// The gate decides which store is authoritative — the browser's `localStorage`,
// or the desktop database — and mounts the shell only when that decision
// succeeds. See `src/Startup.tsx`.
createRoot(root).render(
  <StrictMode>
    <Startup />
  </StrictMode>,
)
