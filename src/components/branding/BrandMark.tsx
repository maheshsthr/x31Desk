import fullLogoUrl from '@/assets/x31desk-logo.png'
import markUrl from '@/assets/x31desk-mark.png'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/utils/cn'

/**
 * Which form of the official logo to render. `full` is the supplied lockup —
 * the symbol above the wordmark — and `mark` is the symbol on its own.
 */
export type BrandVariant = 'full' | 'mark'

type BrandMarkProps = {
  /**
   * `full` wherever the wordmark has room to read (the splash, the About
   * panel); `mark` in compact chrome, such as the title bar's brand slot, where
   * the wordmark would render too small to be legible.
   */
  variant?: BrandVariant
  /** Rendered edge length in pixels. Both assets are square. */
  size?: number
  className?: string
}

/**
 * The official x31Desk logo.
 *
 * Both forms are cropped from `transparent.png` by `scripts/make-logo-assets.ps1`
 * — the full lockup for `full`, the symbol alone for `mark` — and are composed
 * on the artwork's own alpha channel, so the logo sits on whatever the surface
 * behind it happens to be instead of carrying a box of its own. Nothing is
 * redrawn, recoloured or re-lettered, and the wordmark is never substituted
 * with text.
 *
 * `size` is a pixel value rendered in `rem`, so the logo stays proportional to
 * the type around it, like every other metric.
 */
export function BrandMark({ variant = 'full', size = 96, className }: BrandMarkProps) {
  const edge = `${size / 16}rem`
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  if (variant === 'full' && isDark) {
    return (
      <span
        className={cn('inline-flex items-center justify-center rounded-md bg-white p-1 shrink-0', className)}
        style={{ width: edge, height: edge }}
      >
        <img
          src={fullLogoUrl}
          alt="x31Desk"
          className="h-full w-full select-none"
          draggable={false}
        />
      </span>
    )
  }

  return (
    <img
      src={variant === 'full' ? fullLogoUrl : markUrl}
      alt="x31Desk"
      style={{ width: edge, height: edge }}
      className={cn('shrink-0 select-none', className)}
      draggable={false}
    />
  )
}
