import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '@/utils/cn'

/** Props for {@link Surface}. Inherits every attribute of a `div`. */
type SurfaceProps = ComponentPropsWithoutRef<'div'>

/**
 * The standard content surface of the application: the only place where the
 * `surface` background, `line` border and card elevation are combined.
 */
export function Surface({ className, ...props }: SurfaceProps) {
  return (
    <div
      className={cn('rounded-lg border border-line bg-surface shadow-card', className)}
      {...props}
    />
  )
}
