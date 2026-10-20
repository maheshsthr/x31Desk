import { useId } from 'react'

import { cn } from '@/utils/cn'

type SegmentedControlOption<T extends string> = {
  value: T
  label: string
}

type SegmentedControlProps<T extends string> = {
  /** Accessible name for the group, e.g. "Priority". */
  label: string
  options: readonly SegmentedControlOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

/**
 * Single-select control shaped like a segmented button, built from real radio
 * inputs. Using radios rather than buttons means arrow-key navigation, grouping
 * and the checked state all come from the browser; the inputs are visually
 * hidden and the label beside each one *is* the segment.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  const name = useId()

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        // `relative` is the containing block for the hidden inputs below. Without
        // it they are positioned against the viewport, which lets a group that is
        // wider than its pane escape the pane's overflow clipping and widen the
        // whole document. `flex-wrap` lets an over-wide group reflow onto another
        // line rather than run past it.
        'relative flex flex-wrap items-center gap-0.5 rounded-sm border border-line bg-canvas p-0.5',
        className,
      )}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            // The input cannot show a focus ring of its own, so the ring is
            // forwarded to the visible segment.
            // `min-w-16` gives the segment a floor wide enough to wrap onto
            // another line when the group is over-wide, while `flex-1` still
            // spreads the segments evenly whenever they fit on one line.
            'flex h-7 min-w-16 flex-1 cursor-pointer items-center justify-center rounded-xs px-2 text-xs font-medium transition-colors duration-150 ease-standard has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
            option.value === value
              ? 'bg-accent text-on-accent'
              : 'text-ink-muted hover:bg-surface hover:text-ink',
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  )
}
