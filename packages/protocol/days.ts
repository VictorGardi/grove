// Local days as `YYYY-MM-DD` keys. The usage history stores a request's timestamp; the day, and the week, are derived in the
// human's local time wherever they are shown, so a late-night request lands on the day they remember. Weeks start on Monday.

const pad = (n: number): string => String(n).padStart(2, '0')

export function dayKey(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parts(key: string): [number, number, number] {
  const [year, month, day] = key.split('-').map(Number)
  return [year, month - 1, day]
}

// The day `delta` days after `key` (before, when negative), by calendar days, so a day with 23 or 25 hours is still one day.
export function shiftDay(key: string, delta: number): string {
  const [year, month, day] = parts(key)
  return dayKey(new Date(year, month, day + delta).getTime())
}

// 0 for Monday up to 6 for Sunday.
export function weekdayOf(key: string): number {
  const [year, month, day] = parts(key)
  return (new Date(year, month, day).getDay() + 6) % 7
}

// The Monday of the week that holds `key`.
export const weekStart = (key: string): string => shiftDay(key, -weekdayOf(key))
