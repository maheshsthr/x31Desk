import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/utils/cn'

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'> & {
  icon: LucideIcon
  /** Accessible name, also used as the hover tooltip. */
  label: string
}

/** Square, label-less button for toolbars. Always requires an accessible name. */
export function IconButton({
  icon: Icon,
  label,
  type = 'button',
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors duration-150 ease-standard hover:bg-canvas hover:text-ink active:bg-nav-hover disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.9} />
    </button>
  )
}
