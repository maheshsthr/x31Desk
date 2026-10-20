import { useCallback, useEffect, useState } from 'react'

import { useToast } from '@/hooks/useToast'
import { copyTextToClipboard } from '@/utils/clipboard'

/** How long the "copied" confirmation stays on the control that produced it. */
const COPIED_FEEDBACK_MS = 1600

/**
 * Copies text, reports the outcome and briefly flags success.
 *
 * The toast is the accessible announcement; `copied` lets the control itself
 * confirm with an icon so the feedback is where the user is looking, not only
 * in the corner of the screen.
 */
export function useCopyToClipboard() {
  const { notify } = useToast()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) {
      return
    }

    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)

    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = useCallback(
    async (text: string) => {
      const succeeded = await copyTextToClipboard(text)

      setCopied(succeeded)
      notify(succeeded ? 'Copied to clipboard.' : 'Could not copy to the clipboard.')

      return succeeded
    },
    [notify],
  )

  return { copied, copy }
}
