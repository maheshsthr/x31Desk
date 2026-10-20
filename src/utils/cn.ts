import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Joins conditional class names and resolves conflicting Tailwind utilities
 * (the last one wins), so component callers can safely override styles:
 *
 *   cn('px-4 py-2', isActive && 'bg-accent', className)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
