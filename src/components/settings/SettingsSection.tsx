import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Surface } from '@/components/ui/Surface'

type SettingsSectionProps = {
  /** Anchor id, also used to derive the heading id for `aria-labelledby`. */
  id: string
  title: string
  description: string
  icon: LucideIcon
  /** The rows that make up the section. */
  children: ReactNode
}

/**
 * A titled block of settings.
 *
 * Every section is a landmark-labelled `<section>` so the page reads as a set of
 * regions, and the rows inside share one surface divided by hairlines so the
 * page stays compact rather than becoming a stack of cards.
 */
export function SettingsSection({ id, title, description, icon: Icon, children }: SettingsSectionProps) {
  const headingId = `${id}-heading`

  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-6">
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent">
          <Icon aria-hidden className="size-4" strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold text-ink">
            {title}
          </h2>
          <p className="text-xs text-ink-muted">{description}</p>
        </div>
      </div>

      <Surface className="mt-3 divide-y divide-line">{children}</Surface>
    </section>
  )
}
