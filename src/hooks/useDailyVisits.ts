import { useCallback, useEffect, useState } from 'react'
import { localDateKey } from '../lib/tracker'

export const DAILY_VISITS_STORAGE_KEY = 'angelo-daily-visits-v1'

function readDailyVisits(): string[] {
  try {
    const saved = localStorage.getItem(DAILY_VISITS_STORAGE_KEY)
    if (!saved) return []

    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) return []

    return parsed.filter((visit): visit is string => typeof visit === 'string')
  } catch (error) {
    console.error('ANGELO could not load daily visits:', error)
    return []
  }
}

export function useDailyVisits(today: Date): {
  dailyVisits: ReadonlySet<string>
  recordDailyVisit: (date: Date) => void
} {
  const [dailyVisits, setDailyVisits] = useState(
    () => new Set([...readDailyVisits(), localDateKey(today)]),
  )

  useEffect(() => {
    try {
      localStorage.setItem(DAILY_VISITS_STORAGE_KEY, JSON.stringify([...dailyVisits].sort()))
    } catch (error) {
      console.error('ANGELO could not save daily visits:', error)
    }
  }, [dailyVisits])

  const recordDailyVisit = useCallback((date: Date) => {
    const key = localDateKey(date)
    setDailyVisits((current) => current.has(key) ? current : new Set([...current, key]))
  }, [])

  return { dailyVisits, recordDailyVisit }
}
