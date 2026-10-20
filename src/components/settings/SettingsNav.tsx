import type { LucideIcon } from 'lucide-react'

type SettingsNavSection = {
  id: string
  label: string
  icon: LucideIcon
}

type SettingsNavProps = {
  sections: readonly SettingsNavSection[]
}

/**
 * Compact in-page navigation for the settings sections.
 *
 * Rendered as buttons rather than anchor links because the scrolling container
 * is the shell's `<main>`, not the window; `scrollIntoView` targets it reliably
 * and, unlike a hash link, never rewrites the URL. The targets carry
 * `scroll-mt-*` so they land just below the top bar.
 */
export function SettingsNav({ sections }: SettingsNavProps) {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }

  return (
    <nav aria-label="Settings sections" className="lg:sticky lg:top-0 lg:self-start">
      <ul className="flex flex-wrap gap-1 lg:flex-col lg:flex-nowrap lg:gap-0.5">
        {sections.map((section) => (
          <li key={section.id} className="lg:w-full">
            <button
              type="button"
              onClick={() => scrollTo(section.id)}
              className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs font-medium text-ink-muted transition-colors duration-150 ease-standard hover:bg-canvas hover:text-ink"
            >
              <section.icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.9} />
              {section.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
