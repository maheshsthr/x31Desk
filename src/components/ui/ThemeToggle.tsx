import { Moon, Sun } from 'lucide-react'

import { IconButton } from '@/components/ui/IconButton'
import type { Theme } from '@/types/theme'

type ThemeToggleProps = {
  theme: Theme
  onToggle: () => void
  className?: string
}

/**
 * Switches between the light and dark token sets. The icon shows the theme the
 * button switches *to*, which is the convention users expect from toolbars.
 */
export function ThemeToggle({ theme, onToggle, className }: ThemeToggleProps) {
  const isLight = theme === 'light'

  return (
    <IconButton
      icon={isLight ? Moon : Sun}
      label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      onClick={onToggle}
      className={className}
    />
  )
}
