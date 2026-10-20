import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/utils/cn'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Leading icon, rendered at a consistent size and stroke weight. */
  icon?: LucideIcon
  variant?: ButtonVariant
  size?: ButtonSize
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border border-transparent bg-accent text-on-accent hover:bg-accent-strong active:bg-accent-strong/90',
  secondary:
    'border border-line bg-surface text-ink hover:border-accent/40 hover:text-accent active:bg-canvas',
  ghost: 'border border-transparent text-ink-muted hover:bg-canvas hover:text-ink active:bg-nav-hover',
  danger:
    'border border-transparent bg-danger text-on-danger hover:bg-danger-strong active:bg-danger-strong/90',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-xs',
  md: 'h-8 gap-2 px-3 text-sm',
}

/** Compact action button. The primary variant is reserved for one action per view. */
export function Button({
  icon: Icon,
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm font-medium transition-colors duration-150 ease-standard disabled:pointer-events-none disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {Icon ? <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2} /> : null}
      {children}
    </button>
  )
}
