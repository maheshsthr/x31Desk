import { useEffect, useState } from 'react'

import { toDateValue } from '@/utils/date'

type Today = {
  /** Time-of-day greeting, without trailing punctuation. */
  greeting: string
  /** Short local date label, e.g. "Wed, Oct 14". */
  dateLabel: string
  /**
   * The same day as `YYYY-MM-DD`, for comparing against due dates. Calendar
   * comparisons live here so "today" has exactly one definition in the app.
   */
  dateValue: string
}

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

const REFRESH_INTERVAL_MS = 60_000

function getGreeting(hour: number): string {
  if (hour < 12) {
    return 'Good morning'
  }

  if (hour < 18) {
    return 'Good afternoon'
  }

  return 'Good evening'
}

function readToday(): Today {
  const now = new Date()

  return {
    greeting: getGreeting(now.getHours()),
    dateLabel: DATE_FORMATTER.format(now),
    dateValue: toDateValue(now),
  }
}

/**
 * Read once at module load so the first render stays pure (calling `Date` while
 * rendering would make the component impure); the interval below keeps the value
 * accurate afterwards.
 */
const INITIAL_TODAY = readToday()

/**
 * Local-time context for the dashboard header: a time-of-day greeting and a
 * short date label.
 *
 * A desktop window can stay open across a day boundary, so this re-checks once a
 * minute. The state only changes when the greeting or the date actually changes,
 * which keeps the interval from causing needless renders.
 */
export function useToday(): Today {
  const [today, setToday] = useState<Today>(INITIAL_TODAY)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setToday((current) => {
        const next = readToday()

        return next.greeting === current.greeting &&
          next.dateLabel === current.dateLabel &&
          next.dateValue === current.dateValue
          ? current
          : next
      })
    }, REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  return today
}
