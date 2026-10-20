import { Check, ChevronDown } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/utils/cn'

type SelectOption<T extends string> = {
  value: T
  label: string
}

type SelectProps<T extends string> = {
  /** Accessible name. Also printed above the control when `showLabel` is set. */
  label: string
  options: readonly SelectOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Shows the label instead of keeping it available to assistive tech only. */
  showLabel?: boolean
  className?: string
}

/** Space between the trigger and its menu. */
const MENU_GAP = 4

/** The menu scrolls rather than growing past this height. */
const MENU_MAX_HEIGHT = 240

/** Below this there is no point drawing a menu, so it is kept at least this tall. */
const MENU_MIN_HEIGHT = 96

/** Where the portalled menu sits, in viewport coordinates. */
type MenuLayout = {
  left: number
  width: number
  top?: number
  bottom?: number
  maxHeight: number
}

/**
 * A dropdown that looks and behaves like the rest of x31Desk.
 *
 * The native `<select>`'s popup is drawn by the browser and cannot follow the
 * Nordic Blue palette in both themes, so this is a custom listbox instead: a
 * trigger styled like a text field, and a menu that reuses the same surfaces,
 * borders, radius and shadow as every other floating panel in the app.
 *
 * The menu is rendered in a portal with fixed positioning rather than nested
 * beside the trigger. That is what keeps it from being clipped by a scrolling
 * pane or a card's `overflow`, and it flips above the trigger when there is not
 * enough room below. Keyboard support follows the ARIA select-only combobox
 * pattern: focus stays on the trigger, the highlighted option is announced
 * through `aria-activedescendant`, and the arrow keys / Home / End / Enter /
 * Escape / Tab all work as expected.
 */
export function Select<T extends string>({
  label,
  options,
  value,
  onChange,
  showLabel = false,
  className,
}: SelectProps<T>) {
  const id = useId()
  const labelId = `${id}-label`
  const listboxId = `${id}-listbox`

  const [open, setOpen] = useState(false)
  const [layout, setLayout] = useState<MenuLayout | null>(null)

  const selectedIndex = options.findIndex((option) => option.value === value)
  const [activeIndex, setActiveIndex] = useState(selectedIndex < 0 ? 0 : selectedIndex)

  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const optionId = (index: number) => `${id}-option-${index}`
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  /** Positions the menu against the trigger, flipping up when space runs out. */
  const measure = useCallback(() => {
    const button = buttonRef.current

    if (!button) {
      return
    }

    const rect = button.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP
    const spaceAbove = rect.top - MENU_GAP
    const openUp = spaceBelow < MENU_MAX_HEIGHT && spaceAbove > spaceBelow

    setLayout({
      left: rect.left,
      width: rect.width,
      top: openUp ? undefined : rect.bottom + MENU_GAP,
      bottom: openUp ? window.innerHeight - rect.top + MENU_GAP : undefined,
      maxHeight: Math.max(MENU_MIN_HEIGHT, Math.min(MENU_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow)),
    })
  }, [])

  const openMenu = useCallback(() => {
    setActiveIndex(selectedIndex < 0 ? 0 : selectedIndex)
    measure()
    setOpen(true)
  }, [measure, selectedIndex])

  const closeMenu = useCallback((refocus = false) => {
    setOpen(false)

    if (refocus) {
      buttonRef.current?.focus()
    }
  }, [])

  const commit = useCallback(
    (index: number) => {
      const option = options[index]

      if (option) {
        onChange(option.value)
      }

      closeMenu(true)
    },
    [closeMenu, onChange, options],
  )

  // Follow the trigger while the menu is open — scrolling a pane or resizing the
  // window must not leave the menu stranded where the field used to be.
  useEffect(() => {
    if (!open) {
      return
    }

    const handleReposition = () => measure()

    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)

    return () => {
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [measure, open])

  // A click outside the field and its menu dismisses it. Capture-phase, so the
  // menu closes before any click handler underneath reacts.
  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node

      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) {
        return
      }

      setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)

    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [open])

  // Keep the highlighted option in view as the arrow keys walk the list.
  useEffect(() => {
    if (!open) {
      return
    }

    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const handleButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case ' ':
        event.preventDefault()
        openMenu()
        break
      default:
        break
    }
  }

  const handleButtonKeyDownWhenOpen = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((current) => Math.min(current + 1, options.length - 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((current) => Math.max(current - 1, 0))
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(options.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        commit(activeIndex)
        break
      case 'Escape':
        event.preventDefault()
        closeMenu(true)
        break
      case 'Tab':
        closeMenu()
        break
      default:
        break
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (open) {
      handleButtonKeyDownWhenOpen(event)
    } else {
      handleButtonKeyDown(event)
    }
  }

  return (
    <div ref={rootRef} className={cn('flex min-w-0 flex-col', className)}>
      <span id={labelId} className={showLabel ? 'block text-xs font-medium text-ink' : 'sr-only'}>
        {label}
      </span>

      <div className={cn('relative', showLabel && 'mt-1')}>
        <button
          ref={buttonRef}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-labelledby={labelId}
          aria-activedescendant={open ? optionId(activeIndex) : undefined}
          onClick={() => (open ? closeMenu() : openMenu())}
          onKeyDown={handleKeyDown}
          className={cn(
            'flex h-8 w-full items-center rounded-sm border bg-surface pr-7 pl-2.5 text-left text-sm text-ink transition-colors duration-150 ease-standard',
            open ? 'border-accent' : 'border-line hover:border-accent/40',
          )}
        >
          <span className="truncate">{selected?.label ?? ''}</span>
        </button>

        <ChevronDown
          aria-hidden
          strokeWidth={2}
          className={cn(
            'pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-muted transition-transform duration-150 ease-standard',
            open && 'rotate-180',
          )}
        />
      </div>

      {open && layout
        ? createPortal(
            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-labelledby={labelId}
              style={{
                position: 'fixed',
                left: layout.left,
                width: layout.width,
                top: layout.top,
                bottom: layout.bottom,
                maxHeight: layout.maxHeight,
              }}
              className="z-50 overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-floating outline-none"
            >
              {options.map((option, index) => {
                const isSelected = option.value === value
                const isActive = index === activeIndex

                return (
                  <li
                    key={option.value}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    data-index={index}
                    // Keeps focus on the trigger, so the keyboard keeps working
                    // after a mouse selection.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => commit(index)}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 text-sm',
                      isSelected ? 'text-accent' : 'text-ink',
                      isActive && 'bg-accent-soft',
                      isSelected && 'font-medium',
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected ? (
                      <Check aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
                    ) : null}
                  </li>
                )
              })}
            </ul>,
            document.body,
          )
        : null}
    </div>
  )
}
