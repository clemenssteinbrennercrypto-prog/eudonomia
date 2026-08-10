export const HISTORY_TREND_RANGES = [
  { value: 'week', label: 'Week' },
  { value: '30days', label: '30 days' },
  { value: 'year', label: '1 year' },
  { value: 'all', label: 'All' },
]

export function hasMeasuredFocus(session) {
  if (!session || session.scoreMeasured === false) return false
  if (session.trackingFaulted && session.avgFocusScore == null && session.finalScore == null) return false
  return session.actualSeconds > 0 && session.focusedSeconds != null
}

export function sessionFocusPct(session) {
  return hasMeasuredFocus(session)
    ? Math.round((session.focusedSeconds / session.actualSeconds) * 100)
    : null
}

function startOfDay(value) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(value, amount) {
  const date = new Date(value)
  date.setDate(date.getDate() + amount)
  return date
}

function startOfWeek(value) {
  const date = startOfDay(value)
  const daysSinceMonday = (date.getDay() + 6) % 7
  return addDays(date, -daysSinceMonday)
}

function startOfMonth(value) {
  const date = startOfDay(value)
  date.setDate(1)
  return date
}

function addMonths(value, amount) {
  const date = new Date(value)
  date.setDate(1)
  date.setMonth(date.getMonth() + amount)
  return date
}

function dayKey(value) {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function monthKey(value) {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}`
}

function formatDayRange(start, end) {
  const sameYear = start.getFullYear() === end.getFullYear()
  const sameMonth = sameYear && start.getMonth() === end.getMonth()
  const month = value => value.toLocaleDateString('en-US', { month: 'short' })
  if (sameMonth) {
    return `${month(start)} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`
  }
  if (sameYear) {
    return `${month(start)} ${start.getDate()}–${month(end)} ${end.getDate()}, ${end.getFullYear()}`
  }
  return `${month(start)} ${start.getDate()}, ${start.getFullYear()}–${month(end)} ${end.getDate()}, ${end.getFullYear()}`
}

function formatMonthRange(start, end) {
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()
  if (sameMonth) {
    return start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }
  return `${start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}–${end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
}

function getValidSessionDates(sessions) {
  return sessions
    .map(session => new Date(session?.timestamp))
    .filter(date => !Number.isNaN(date.getTime()))
}

function getWindow(sessions, range, weekOffset, now) {
  const today = startOfDay(now)

  if (range === '30days') {
    const endExclusive = addDays(today, 1)
    return { start: addDays(endExclusive, -30), endExclusive, unit: 'day' }
  }

  if (range === 'year') {
    const endExclusive = addMonths(startOfMonth(today), 1)
    return { start: addMonths(endExclusive, -12), endExclusive, unit: 'month' }
  }

  if (range === 'all') {
    const dates = getValidSessionDates(sessions)
    const earliest = dates.length
      ? new Date(Math.min(...dates.map(date => date.getTime())))
      : today
    const endExclusive = addMonths(startOfMonth(today), 1)
    const start = startOfMonth(earliest > today ? today : earliest)
    return { start, endExclusive, unit: 'month' }
  }

  const safeOffset = Math.min(0, Number.isFinite(weekOffset) ? Math.trunc(weekOffset) : 0)
  const start = addDays(startOfWeek(today), safeOffset * 7)
  return { start, endExclusive: addDays(start, 7), unit: 'day' }
}

function createBuckets(start, endExclusive, unit) {
  const buckets = []
  let cursor = new Date(start)

  while (cursor < endExclusive) {
    const bucketStart = new Date(cursor)
    const isDay = unit === 'day'
    const label = isDay
      ? bucketStart.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3)
      : bucketStart.toLocaleDateString('en-US', { month: 'short' })
    const dateLabel = isDay
      ? bucketStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : bucketStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

    buckets.push({
      key: isDay ? dayKey(bucketStart) : monthKey(bucketStart),
      label,
      dateLabel,
      avgFocus: null,
      count: 0,
      _focusTotal: 0,
      _measuredCount: 0,
    })
    cursor = isDay ? addDays(cursor, 1) : addMonths(cursor, 1)
  }

  return buckets
}

export function buildHistoryTrend(sessions, options = {}) {
  const safeSessions = Array.isArray(sessions) ? sessions.filter(Boolean) : []
  const range = HISTORY_TREND_RANGES.some(option => option.value === options.range)
    ? options.range
    : 'week'
  const now = new Date(options.now ?? Date.now())
  const safeNow = Number.isNaN(now.getTime()) ? new Date() : now
  const weekOffset = Math.min(0, Number.isFinite(options.weekOffset) ? Math.trunc(options.weekOffset) : 0)
  const { start, endExclusive, unit } = getWindow(safeSessions, range, weekOffset, safeNow)
  const buckets = createBuckets(start, endExclusive, unit)
  const byKey = new Map(buckets.map(bucket => [bucket.key, bucket]))

  for (const session of safeSessions) {
    const date = new Date(session.timestamp)
    if (Number.isNaN(date.getTime()) || date < start || date >= endExclusive) continue
    const bucket = byKey.get(unit === 'day' ? dayKey(date) : monthKey(date))
    if (!bucket) continue
    bucket.count += 1
    const pct = sessionFocusPct(session)
    if (pct == null) continue
    bucket._focusTotal += pct
    bucket._measuredCount += 1
  }

  for (const bucket of buckets) {
    if (bucket._measuredCount > 0) {
      bucket.avgFocus = Math.round(bucket._focusTotal / bucket._measuredCount)
    }
    delete bucket._focusTotal
    delete bucket._measuredCount
  }

  const visibleEnd = unit === 'day'
    ? addDays(endExclusive, -1)
    : addMonths(endExclusive, -1)

  return {
    range,
    buckets,
    title: unit === 'day'
      ? formatDayRange(start, visibleEnd)
      : formatMonthRange(start, visibleEnd),
    canGoForward: range === 'week' && weekOffset < 0,
  }
}
