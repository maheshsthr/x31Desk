import type { SnippetLanguage } from '@/types/snippet'
import { LANGUAGE_LABELS } from '@/utils/snippet'

type SnippetLanguageBadgeProps = {
  language: SnippetLanguage
  className?: string
}

/**
 * The language a snippet is filed under, as a compact chip.
 *
 * UI font rather than the code font: this names a language rather than showing
 * one, and JetBrains Mono is reserved for code and key hints.
 */
export function SnippetLanguageBadge({ language, className }: SnippetLanguageBadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-xs border border-line bg-surface px-1.5 py-px text-2xs text-ink-muted ${className ?? ''}`}
    >
      {LANGUAGE_LABELS[language]}
    </span>
  )
}
