import { useEffect, useState } from 'react'

/**
 * The window-control surface the custom title bar draws, in one hook.
 *
 * `null` in a plain browser: there is no bridge, hence no window to control,
 * and the title bar renders its menus and brand without the caption buttons.
 * Inside Electron the hook owns the *state* half of the feature — the initial
 * maximize read plus the main process's pushes — so the button's glyph is
 * correct no matter which side moved the window (the button, a snap to a
 * screen edge, or the operating system's double-click on the drag region).
 *
 * The three actions are fire-and-forget: each resolves once the main process
 * has performed the operation, and a rejection (which can only mean the window
 * is already gone) is reported rather than left as an unhandled rejection.
 */
export type WindowControls = {
  /** Whether the window is maximized — what the middle button draws. */
  maximized: boolean
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
}

export function useWindowControls(): WindowControls | null {
  const controls =
    typeof window === 'undefined' ? undefined : window.x31deskDesktop?.windowControls

  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!controls) {
      return
    }

    // Subscribe before reading, so a state change between the two can never be
    // lost; `alive` keeps a slow read from writing into an unmounted bar.
    let alive = true
    const unsubscribe = controls.onMaximizedChanged((state) => {
      if (alive) {
        setMaximized(state.maximized)
      }
    })

    controls
      .getState()
      .then((state) => {
        if (alive) {
          setMaximized(state.maximized)
        }
      })
      .catch(() => {
        // The window is gone (or going); the buttons have nothing left to draw.
      })

    return () => {
      alive = false
      unsubscribe()
    }
  }, [controls])

  if (!controls) {
    return null
  }

  const report = (operation: string) => (error: unknown) => {
    console.error(`[x31desk] window ${operation} failed:`, error)
  }

  return {
    maximized,
    minimize: () => {
      void controls.minimize().catch(report('minimize'))
    },
    toggleMaximize: () => {
      void controls.toggleMaximize().catch(report('maximize'))
    },
    close: () => {
      void controls.close().catch(report('close'))
    },
  }
}
