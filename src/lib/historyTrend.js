import { WEBVIEW_CAMERA_MEASUREMENT } from './cameraMeasurement'

export const HISTORY_TREND_RANGES = [
  { value: 'week', label: 'Week' },
  { value: '30days', label: '30 days' },
  { value: 'year', label: '1 year' },
  { value: 'all', label: 'All' },
]

// Comparisons happen within one measurement generation, never across two.
//
// This used to pin every comparison to V1, which meant that once someone
// switched to the native camera their sessions disappeared from trends and
// patterns entirely. The rule now is relative: whichever generation is newest
// in the data at hand is the one compared, and the others are kept but not
// mixed in. Missing versions are pre-versioning V1 records.
export function focusGenerationOf(session) {
  return session?.attentionScoringVersion ?? WEBVIEW_CAMERA_MEASUREMENT.attentionScoringVersion
}

/** The generation a set of sessions should be compared on — the newest present. */
export function activeFocusGeneration(sessions) {
  const versions = (Array.isArray(sessions) ? sessions : [])
    .filter(Boolean)
    .map(focusGenerationOf)
    .filter(Number.isFinite)
  return versions.length ? Math.max(...versions) : WEBVIEW_CAMERA_MEASUREMENT.attentionScoringVersion
}

// Takes an explicit generation. Never pass this straight to Array.filter —
// filter supplies the index as the second argument, which would silently
// compare against 0, 1, 2… Use comparableSessions() for lists.
export function isComparableFocusGeneration(session, generation = WEBVIEW_CAMERA_MEASUREMENT.attentionScoringVersion) {
  return focusGenerationOf(session) === generation
}

/** Narrow a list to the single generation it should be compared on. */
export function comparableSessions(sessions) {
  const safe = Array.isArray(sessions) ? sessions.filter(Boolean) : []
  const generation = activeFocusGeneration(safe)
  return safe.filter(session => isComparableFocusGeneration(session, generation))
}

export function sessionFocusMeasurement(session) {
  if (!session || session.scoreMeasured === false) return null
  if (session.trackingFaulted && session.avgFocusScore == null && session.finalScore == null) return null
  if (!Number.isFinite(session.focusedSeconds) || session.focusedSeconds < 0) return null

  // A present-but-zero measuredSeconds field explicitly means no measurement.
  // Falling back to wall time here would turn a camera failure into 0% focus.
  const hasMeasuredField = session.measuredSeconds != null
  const hasMeasurementSummary = Number.isFinite(session.avgFocusScore) || Number.isFinite(session.finalScore)
  const hasTimelineEvidence = Array.isArray(session.timeline) && session.timeline.some(sample =>
    Number.isFinite(sample?.second) && Number.isFinite(sample?.score))
  // Current-format records always write a summary and timeline. Requiring one
  // of them stops a malformed object containing only two counters from
  // rendering as measured, while pre-summary legacy records retain their
  // explicit wall-time fallback below.
  if (hasMeasuredField && !hasMeasurementSummary && !hasTimelineEvidence) return null
  const measuredSeconds = hasMeasuredField ? session.measuredSeconds : session.actualSeconds
  if (!Number.isFinite(measuredSeconds) || measuredSeconds <= 0) return null
  if (!Number.isFinite(session.actualSeconds) || session.actualSeconds <= 0) return null
  if (measuredSeconds > session.actualSeconds + 1) return null
  if (session.focusedSeconds > measuredSeconds) return null
  return { focusedSeconds: session.focusedSeconds, measuredSeconds }
}

export function hasMeasuredFocus(session) {
  return sessionFocusMeasurement(session) != null
}

export function sessionFocusPct(session) {
  const measurement = sessionFocusMeasurement(session)
  return measurement
    ? Math.round((measurement.focusedSeconds / measurement.measuredSeconds) * 100)
    : null
}

/**
 * The session's mean attention score, 0-100 — "how focused was I", as opposed
 * to `sessionFocusPct`, which answers the narrower "what share of the time was
 * I over the threshold".
 *
 * Both are honest, but a mean is the number people actually expect from a
 * focus tracker, and it is the same quantity the daily Focus Score already
 * reports as its efficiency term, so using it here makes one figure mean one
 * thing across the app.
 *
 * Gated on the same measurement validity as everything else: a session with no
 * usable measurement returns null rather than a misleading zero. `scoreSum` is
 * preferred because it is the raw accumulator; `avgFocusScore` is the stored
 * rounding of it and covers records written before scoreSum existed.
 */
export function sessionAverageFocus(session) {
  const measurement = sessionFocusMeasurement(session)
  if (!measurement) return null

  // Preferred: the raw accumulator.
  if (Number.isFinite(session.scoreSum) && measurement.measuredSeconds > 0) {
    const mean = session.scoreSum / measurement.measuredSeconds
    if (mean >= 0 && mean <= 100) return Math.round(mean)
  }
  // Its stored rounding, for records written before scoreSum existed.
  if (Number.isFinite(session.avgFocusScore)) return Math.round(session.avgFocusScore)

  // Older records can pass the measurement check on timeline evidence alone,
  // carrying per-second scores but no summary field. Averaging those is a real
  // computation, not a guess — and without it a session that was genuinely
  // measured would start reporting "not measured" purely because this metric
  // changed, which is a worse answer than the one it replaced.
  const samples = Array.isArray(session.timeline)
    ? session.timeline.map(sample => sample?.score).filter(score => Number.isFinite(score) && score >= 0 && score <= 100)
    : []
  if (samples.length > 0) {
    return Math.round(samples.reduce((sum, score) => sum + score, 0) / samples.length)
  }
  return null
}

/** Mean attention across several sessions, weighted by measured time so a
 *  five-minute session cannot outweigh a two-hour one. */
export function aggregateAverageFocus(sessions) {
  const safeSessions = comparableSessions(sessions)
  let scoreSeconds = 0
  let measuredSeconds = 0
  for (const session of safeSessions) {
    const measurement = sessionFocusMeasurement(session)
    const average = sessionAverageFocus(session)
    if (!measurement || average == null) continue
    scoreSeconds += average * measurement.measuredSeconds
    measuredSeconds += measurement.measuredSeconds
  }
  return measuredSeconds > 0 ? Math.round(scoreSeconds / measuredSeconds) : null
}

export function aggregateFocusMeasurements(sessions) {
  const safeSessions = comparableSessions(sessions)
  const totals = safeSessions.reduce((sum, session) => {
    const measurement = sessionFocusMeasurement(session)
    if (!measurement) return sum
    return {
      focusedSeconds: sum.focusedSeconds + measurement.focusedSeconds,
      measuredSeconds: sum.measuredSeconds + measurement.measuredSeconds,
      sessionCount: sum.sessionCount + 1,
    }
  }, { focusedSeconds: 0, measuredSeconds: 0, sessionCount: 0 })
  return {
    ...totals,
    focusPct: totals.measuredSeconds > 0
      ? Math.round((totals.focusedSeconds / totals.measuredSeconds) * 100)
      : null,
  }
}

function normalizedOutcome(session) {
  if (session?.goalOutcome) return session.goalOutcome
  if (session?.goalAchieved === true) return 'yes'
  if (session?.goalAchieved === false) return 'no'
  return null
}

/** Counts of yes/partly/no/unrated across a set of sessions — the raw material
 *  for Overview's outcome distribution. Unrated is its own bucket rather than
 *  dropped, since "you didn't say" is a real, visible state. */
export function outcomeDistribution(sessions) {
  const counts = { yes: 0, partly: 0, no: 0, unrated: 0 }
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const outcome = normalizedOutcome(session)
    counts[outcome || 'unrated'] += 1
  }
  return counts
}

export function measuredSessionDayStreak(sessions, now = Date.now()) {
  const current = new Date(now)
  if (Number.isNaN(current.getTime())) return 0
  const safeSessions = Array.isArray(sessions) ? sessions : []
  const activeDays = new Set(comparableSessions(safeSessions)
    .filter(hasMeasuredFocus)
    .map(session => {
      const date = new Date(session.timestamp)
      return Number.isNaN(date.getTime()) ? null : dayKey(date)
    })
    .filter(Boolean))
  let cursor = startOfDay(current)
  if (!activeDays.has(dayKey(cursor))) cursor = addDays(cursor, -1)
  let streak = 0
  while (activeDays.has(dayKey(cursor))) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
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
      _focusedSeconds: 0,
      _measuredSeconds: 0,
    })
    cursor = isDay ? addDays(cursor, 1) : addMonths(cursor, 1)
  }

  return buckets
}

export function buildHistoryTrend(sessions, options = {}) {
  const safeSessions = comparableSessions(sessions)
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
    const measurement = sessionFocusMeasurement(session)
    const average = sessionAverageFocus(session)
    if (!measurement || average == null) continue
    // Weighted by measured time, so a five-minute session cannot swing a day
    // as hard as a two-hour one.
    bucket._focusedSeconds += average * measurement.measuredSeconds
    bucket._measuredSeconds += measurement.measuredSeconds
  }

  for (const bucket of buckets) {
    if (bucket._measuredSeconds > 0) {
      bucket.avgFocus = Math.round(bucket._focusedSeconds / bucket._measuredSeconds)
    }
    delete bucket._focusedSeconds
    delete bucket._measuredSeconds
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
