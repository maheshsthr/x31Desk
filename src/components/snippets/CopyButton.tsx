import { Check, Copy } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'

type CopyButtonProps = {
  /** The text placed on the clipboard. */
  text: string
  /** Visible label, or the accessible name when `iconOnly`. */
  label: string
  /** Square, label-less button for tight spots such as a list row. */
  iconOnly?: boolean
  /** Keyboard hint rendered beside the label. */
  shortcut?: string
  disabled?: boolean
  className?: string
}

/**
 * Copy-to-clipboard control with its own feedback.
 *
 * The icon flips to a check and the label becomes "Copied" for a moment, while
 * the toast reports whether the clipboard actually took the text — a copy that
 * silently failed is worse than no button at all.
 */
export function CopyButton({
  text,
  label,
  iconOnly = false,
  shortcut,
  disabled = false,
  className,
}: CopyButtonProps) {
  const { copied, copy } = useCopyToClipboard()
  const Icon = copied ? Check : Copy
  const actionLabel = copied ? 'Copied' : label

  if (iconOnly) {
    return (
      <IconButton
        icon={Icon}
        label={actionLabel}
        disabled={disabled}
        onClick={() => void copy(text)}
        className={className}
      />
    )
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      icon={Icon}
      disabled={disabled}
      onClick={() => void copy(text)}
      className={className}
    >
      {actionLabel}
      {shortcut ? (
        <kbd className="ml-0.5 hidden shrink-0 rounded-xs border border-line bg-surface px-1 py-0.5 font-mono text-2xs text-ink-muted lg:inline">
          {shortcut}
        </kbd>
      ) : null}
    </Button>
  )
}
