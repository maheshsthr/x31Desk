/**
 * Date helpers.
 *
 * Formatters are created once at module scope: building an `Intl.DateTimeFormat`
 * is comparatively expensive and these are called for every row on every render.
 *
 * Two kinds of date live in the application and they are deliberately kept
 * apart:
 *
 *  - **instants** (record timestamps) are epoch milliseconds and are handed
 *    straight to `Intl`;
 *  - **calendar days** (a task's due date) are `YYYY-MM-DD` strings in the
 *    user's own timezone. They are never parsed with `new Date(value)`, because
 *    `new Date('2026-10-14')` is UTC midnight and would read back as the 13th
 *    for anyone west of Greenwich. The helpers below parse them as local dates
 *    instead, which is what keeps "due today" meaning today.
 */

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
})

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const monthDayFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
})

const monthDayYearFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const longDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

const DATE_VALUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** Compact date for list rows, e.g. `Oct 14`. */
export function formatShortDate(timestamp: number): string {
  return shortDateFormatter.format(timestamp)
}

/** Precise date and time for record metadata, e.g. `Oct 14, 2026, 11:32 AM`. */
export function formatDateTime(timestamp: number): string {
  return dateTimeFormatter.format(timestamp)
}

/** `YYYY-MM-DD` for a date in the local calendar. */
export function toDateValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

/**
 * Parses `YYYY-MM-DD` as a local midnight, returning `null` for anything that
 * is not a real calendar day. `2026-02-31` is rejected rather than silently
 * rolling over into March.
 */
export function parseDateValue(value: string): Date | null {
  const match = DATE_VALUE_PATTERN.exec(value)

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }

  return date
}

/** True when `value` is a real `YYYY-MM-DD` calendar day. */
export function isDateValue(value: string): boolean {
  return parseDateValue(value) !== null
}

/**
 * Shifts a calendar day by whole days, staying in local time. Adding a day to
 * `2026-03-31` yields `2026-04-01` rather than an instant 24 hours later, so
 * daylight-saving transitions cannot skip or repeat a day.
 */
export function shiftDateValue(value: string, days: number): string | null {
  const date = parseDateValue(value)

  if (!date) {
    return null
  }

  date.setDate(date.getDate() + days)

  return toDateValue(date)
}

/**
 * Human label for a due date relative to `today`: `Today`, `Tomorrow`,
 * `Yesterday`, otherwise `Oct 14` — or `Oct 14, 2027` when the year differs, so
 * a distant date is never ambiguous.
 */
export function formatDueDate(value: string, today: string): string {
  const date = parseDateValue(value)

  if (!date) {
    return value
  }

  if (value === today) {
    return 'Today'
  }

  if (value === shiftDateValue(today, 1)) {
    return 'Tomorrow'
  }

  if (value === shiftDateValue(today, -1)) {
    return 'Yesterday'
  }

  const todayDate = parseDateValue(today)

  return todayDate && date.getFullYear() === todayDate.getFullYear()
    ? monthDayFormatter.format(date)
    : monthDayYearFormatter.format(date)
}

/** Full label for tooltips and accessible names, e.g. `Tuesday, October 14, 2026`. */
export function formatLongDate(value: string): string {
  const date = parseDateValue(value)

  return date ? longDateFormatter.format(date) : value
}
