// Versioned, pure focus-rollup logic. The live attention score is deliberately
// out of scope here: this module only summarizes measurements a session already
// produced. Keep every estimated product constant together so a later review
// can create V2 without silently rewriting V1 history.

export const ATTENTION_SCORING_VERSION = 1

export const FOCUS_METRIC_V1 = Object.freeze({
  version: 1,
  minMeasuredSeconds: 5 * 60,
  minCoverage: 0.80,
  calibrationSeconds: 20,
  fullDayMinutes: 120,
  calibrationReviewDays: 30,
  efficiencyExponent: 0.75,
  volumeExponent: 0.25,
  legacyTimelineSampleSeconds: 5,
  minLegacyTimelineSamples: 12,
  minLegacyTimelineCoverage: 0.80,
  phaseWeights: Object.freeze({
    lock_in: 1.00,
    ramp: 0.75,
    arrival: 0.50,
    recovery: 0.35,
    fade: 0.20,
    drift: 0.00,
  }),
})

const DAY_MS = 24 * 60 * 60 * 1000

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
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

function addMonths(value, amount) {
  const date = new Date(value)
  date.setDate(1)
  date.setMonth(date.getMonth() + amount)
  return date
}

function startOfWeek(value) {
  const date = startOfDay(value)
  return addDays(date, -((date.getDay() + 6) % 7))
}

function startOfMonth(value) {
  const date = startOfDay(value)
  date.setDate(1)
  return date
}

function startOfYear(value) {
  const date = startOfDay(value)
  date.setMonth(0, 1)
  return date
}

export function localDayKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function phaseTotals(phaseSeconds) {
  if (!phaseSeconds || typeof phaseSeconds !== 'object') return null
  let measuredSeconds = 0
  let deepFocusSeconds = 0
  for (const [phase, weight] of Object.entries(FOCUS_METRIC_V1.phaseWeights)) {
    const seconds = phaseSeconds[phase] ?? 0
    if (!finiteNonNegative(seconds)) return null
    measuredSeconds += seconds
    deepFocusSeconds += seconds * weight
  }
  return { measuredSeconds, deepFocusSeconds }
}

// Sessions written before the daily ledger still contain genuine camera
// measurements: one score snapshot every five seconds plus exact per-phase
// second totals. Recover those measurements with explicit provenance instead
// of pretending the old record was written by the current accumulator schema.
// A headline focus percentage alone is intentionally insufficient.
export function recoverLegacyTimelineMeasurement(session) {
  if (session?.attentionScoringVersion != null) return null
  const phases = phaseTotals(session?.focusPhases?.seconds)
  if (!phases || phases.measuredSeconds <= 0 || !finiteNonNegative(session?.actualSeconds)) return null
  if (!Array.isArray(session?.timeline)) return null

  const samplesBySecond = new Map()
  for (const sample of session.timeline) {
    if (
      !finiteNonNegative(sample?.second) ||
      !Number.isFinite(sample?.score) ||
      sample.score < 0 ||
      sample.score > 100
    ) continue
    samplesBySecond.set(sample.second, sample.score)
  }
  const samples = [...samplesBySecond.entries()].sort(([a], [b]) => a - b)
  const scores = samples.map(([, score]) => score)
  if (scores.length < FOCUS_METRIC_V1.minLegacyTimelineSamples) return null

  // setInterval can skip ideal five-second boundaries while the per-second
  // camera/phase accumulator continues. Validate that samples span the session,
  // not that every ideal slot exists; density is not camera coverage.
  const representedSeconds = Math.min(phases.measuredSeconds,
    samples[samples.length - 1][0] - samples[0][0] + FOCUS_METRIC_V1.legacyTimelineSampleSeconds)
  const timelineCoverage = representedSeconds / phases.measuredSeconds
  if (timelineCoverage < FOCUS_METRIC_V1.minLegacyTimelineCoverage) return null

  const averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length
  return {
    attentionScoringVersion: ATTENTION_SCORING_VERSION,
    actualSeconds: session.actualSeconds,
    measuredSeconds: phases.measuredSeconds,
    scoreSum: averageScore * phases.measuredSeconds,
    focusPhases: session.focusPhases,
    focusMeasurementSource: 'legacy_timeline_v1',
    legacyTimelineCoverage: Math.round(timelineCoverage * 1000) / 1000,
  }
}

export function buildFocusMetricDiagnostics(sessions, ledger) {
  const safeLedger = ledger?.schemaVersion === 1 && ledger.days ? ledger : emptyFocusLedger()
  return {
    diagnosticVersion: 1,
    focusMetricVersion: FOCUS_METRIC_V1.version,
    attentionScoringVersion: ATTENTION_SCORING_VERSION,
    sessions: (sessions || []).map((session, index) => {
      const phases = phaseTotals(session?.focusPhases?.seconds)
      const validSamples = Array.isArray(session?.timeline)
        ? session.timeline.filter(sample =>
          finiteNonNegative(sample?.second) &&
          Number.isFinite(sample?.score) &&
          sample.score >= 0 && sample.score <= 100)
        : []
      const seconds = [...new Set(validSamples.map(sample => sample.second))].sort((a, b) => a - b)
      const spanSeconds = seconds.length
        ? seconds[seconds.length - 1] - seconds[0] + FOCUS_METRIC_V1.legacyTimelineSampleSeconds
        : 0
      const recovered = recoverLegacyTimelineMeasurement(session)
      const derived = deriveSessionFocusMetric(session)
      const day = localDayKey(session?.startedAt ?? session?.timestamp)
      const ledgerItem = day && session?.id ? safeLedger.days[day]?.sessions?.[session.id] : null
      return {
        index,
        actualSeconds: Number.isFinite(session?.actualSeconds) ? session.actualSeconds : null,
        storedAttentionScoringVersion: session?.attentionScoringVersion ?? null,
        storedFocusMetricVersion: session?.focusMetricVersion ?? null,
        storedMeasuredSeconds: Number.isFinite(session?.measuredSeconds) ? session.measuredSeconds : null,
        storedScoreSum: Number.isFinite(session?.scoreSum) ? session.scoreSum : null,
        storedMeasurementSource: session?.focusMeasurementSource || null,
        storedRejection: session?.focusMetricRejection || null,
        phaseSeconds: phases?.measuredSeconds ?? null,
        phaseValues: Object.fromEntries(Object.keys(FOCUS_METRIC_V1.phaseWeights)
          .map(phase => [phase, Number.isFinite(session?.focusPhases?.seconds?.[phase])
            ? session.focusPhases.seconds[phase]
            : null])),
        timelineIsArray: Array.isArray(session?.timeline),
        timelineLength: Array.isArray(session?.timeline) ? session.timeline.length : null,
        validScoreSamples: validSamples.length,
        uniqueScoreSeconds: seconds.length,
        firstScoreSecond: seconds[0] ?? null,
        lastScoreSecond: seconds[seconds.length - 1] ?? null,
        scoreSpanSeconds: spanSeconds,
        recoveredFromLegacyTimeline: Boolean(recovered),
        currentDerivedRejection: derived.focusMetricRejection,
        currentMeasurementCoverage: derived.measurementCoverage,
        ledgerState: ledgerItem
          ? ledgerItem.status === 'unmeasured' ? 'unmeasured' : 'measured'
          : 'missing',
      }
    }),
  }
}

function measurementForMetric(session) {
  if (session?.attentionScoringVersion === ATTENTION_SCORING_VERSION) return session
  return recoverLegacyTimelineMeasurement(session) || session
}

export function deriveSessionFocusMetric(session) {
  const measurement = measurementForMetric(session)
  const measuredSeconds = measurement?.measuredSeconds
  const scoreSum = measurement?.scoreSum
  const actualSeconds = measurement?.actualSeconds
  const phases = phaseTotals(measurement?.focusPhases?.seconds)

  const reject = (reason, coverage = null) => ({
    focusMetricVersion: FOCUS_METRIC_V1.version,
    sessionEfficiency: null,
    deepFocusMinutes: null,
    measurementCoverage: coverage,
    focusMetricRejection: reason,
  })

  if (measurement?.attentionScoringVersion !== ATTENTION_SCORING_VERSION) {
    return reject('legacy_scoring_version')
  }
  if (!finiteNonNegative(actualSeconds) || !finiteNonNegative(measuredSeconds) || !finiteNonNegative(scoreSum)) {
    return reject('invalid_measurement')
  }
  if (!phases || Math.abs(phases.measuredSeconds - measuredSeconds) > 1) {
    return reject('invalid_measurement')
  }

  const eligibleSeconds = Math.max(0, actualSeconds - FOCUS_METRIC_V1.calibrationSeconds)
  const coverage = eligibleSeconds > 0 ? clamp(measuredSeconds / eligibleSeconds, 0, 1) : 0
  if (measuredSeconds < FOCUS_METRIC_V1.minMeasuredSeconds) {
    return reject('insufficient_duration', coverage)
  }
  if (coverage < FOCUS_METRIC_V1.minCoverage) {
    return reject('low_coverage', coverage)
  }

  const rawEfficiency = scoreSum / measuredSeconds
  if (!Number.isFinite(rawEfficiency) || rawEfficiency < 0 || rawEfficiency > 100) {
    return reject('invalid_measurement', coverage)
  }

  return {
    focusMetricVersion: FOCUS_METRIC_V1.version,
    sessionEfficiency: clamp(Math.round(rawEfficiency), 1, 100),
    deepFocusMinutes: Math.round((phases.deepFocusSeconds / 60) * 10) / 10,
    measurementCoverage: Math.round(coverage * 1000) / 1000,
    focusMeasurementSource: measurement.focusMeasurementSource || 'live_v1',
    focusMetricRejection: null,
  }
}

export function withSessionFocusMetric(session) {
  const recovered = recoverLegacyTimelineMeasurement(session)
  return { ...session, ...(recovered || {}), ...deriveSessionFocusMetric(recovered ? { ...session, ...recovered } : session) }
}

// A session's headline "focus %" (fraction of TRACKED time above threshold)
// says nothing about how much of the session was tracked at all, so a
// session can read as a great result while still being silently excluded
// from the (coverage-gated) daily score. Give that silence a reason.
export function describeFocusMetricRejection(reason, { measuredSeconds, measurementCoverage } = {}) {
  const measuredMinutes = Number.isFinite(measuredSeconds) ? Math.round(measuredSeconds / 60) : 0
  const coveragePct = Number.isFinite(measurementCoverage) ? Math.round(measurementCoverage * 100) : null
  switch (reason) {
    case 'insufficient_duration':
      return `Only ${measuredMinutes} min of usable tracking — the daily score needs at least ${FOCUS_METRIC_V1.minMeasuredSeconds / 60} measured minutes.`
    case 'low_coverage':
      return `Camera tracking covered only ${coveragePct ?? '<80'}% of this session (sleep, lid close, lost permission, or a dropped feed all count) — the daily score needs at least ${Math.round(FOCUS_METRIC_V1.minCoverage * 100)}%.`
    case 'legacy_scoring_version':
      return 'This session used an older scoring version, so it is not counted toward your daily score.'
    case 'invalid_measurement':
      return "This session's tracking data didn't validate, so it wasn't counted toward your daily score."
    default:
      return null
  }
}

export function emptyFocusLedger() {
  return { schemaVersion: 1, days: {} }
}

function validContribution(session) {
  if (
    session?.attentionScoringVersion !== ATTENTION_SCORING_VERSION ||
    session?.focusMetricVersion !== FOCUS_METRIC_V1.version ||
    !Number.isFinite(session?.sessionEfficiency) ||
    !finiteNonNegative(session?.measuredSeconds) ||
    !finiteNonNegative(session?.scoreSum) ||
    !finiteNonNegative(session?.deepFocusMinutes)
  ) return null

  const day = localDayKey(session.startedAt ?? session.timestamp)
  if (!day || !session.id) return null
  return {
    day,
    value: {
      version: FOCUS_METRIC_V1.version,
      measuredSeconds: session.measuredSeconds,
      scoreSum: session.scoreSum,
      deepFocusSeconds: session.deepFocusMinutes * 60,
      source: session.focusMeasurementSource || 'live_v1',
    },
  }
}

function sessionMarker(session) {
  const day = localDayKey(session?.startedAt ?? session?.timestamp)
  if (!day || !session?.id) return null
  return {
    day,
    value: {
      version: FOCUS_METRIC_V1.version,
      status: 'unmeasured',
      rejection: session?.focusMetricRejection || 'invalid_measurement',
    },
  }
}

export function addSessionToFocusLedger(ledger, session) {
  // Keep a marker even when a session cannot contribute a score. That lets the
  // calendar distinguish "no activity" (0) from "activity existed, but was not
  // measured reliably" (null) without turning a camera failure into a score.
  const contribution = validContribution(session) || sessionMarker(session)
  if (!contribution) return ledger || emptyFocusLedger()
  const safe = ledger?.schemaVersion === 1 && ledger.days ? ledger : emptyFocusLedger()
  const previousDay = safe.days[contribution.day] || { sessions: {} }
  return {
    ...safe,
    days: {
      ...safe.days,
      [contribution.day]: {
        sessions: {
          ...(previousDay.sessions || {}),
          [session.id]: contribution.value,
        },
      },
    },
  }
}

// Recover sessions that never made it into the ledger — an older build that
// predates this ledger entirely, a save that raced a crash, whatever the
// cause. Current sessions must carry valid, version-matched v1 accumulators;
// pre-ledger sessions must pass the stricter legacy timeline recovery above.
// A percentage alone is never backfilled. Valid contributions already present
// are untouched, while an old unmeasured marker may be upgraded when its raw
// timeline proves usable. This is safe to run on every app start.
export function backfillFocusLedger(ledger, sessions) {
  let next = ledger?.schemaVersion === 1 && ledger.days ? ledger : emptyFocusLedger()
  for (const session of sessions || []) {
    if (!session?.id) continue
    const day = localDayKey(session.startedAt ?? session.timestamp)
    const recorded = day ? next.days[day]?.sessions?.[session.id] : null
    if (recorded && recorded.status !== 'unmeasured') continue
    next = addSessionToFocusLedger(next, withSessionFocusMetric(session))
  }
  return next
}

export function removeSessionFromFocusLedger(ledger, sessionId) {
  const safe = ledger?.schemaVersion === 1 && ledger.days ? ledger : emptyFocusLedger()
  let changed = false
  const days = {}
  for (const [day, entry] of Object.entries(safe.days)) {
    const sessions = { ...(entry?.sessions || {}) }
    if (Object.prototype.hasOwnProperty.call(sessions, sessionId)) {
      delete sessions[sessionId]
      changed = true
    }
    if (Object.keys(sessions).length > 0) days[day] = { sessions }
  }
  return changed ? { ...safe, days } : safe
}

export function calculateDailyFocus(dayEntry) {
  const contributions = Object.values(dayEntry?.sessions || {})
    .filter(item =>
      item?.version === FOCUS_METRIC_V1.version &&
      finiteNonNegative(item.measuredSeconds) &&
      item.measuredSeconds > 0 &&
      finiteNonNegative(item.scoreSum) &&
      item.scoreSum <= item.measuredSeconds * 100 &&
      finiteNonNegative(item.deepFocusSeconds) &&
      item.deepFocusSeconds <= item.measuredSeconds
    )
  if (contributions.length === 0) return null

  const totals = contributions.reduce((sum, item) => ({
    measuredSeconds: sum.measuredSeconds + item.measuredSeconds,
    scoreSum: sum.scoreSum + item.scoreSum,
    deepFocusSeconds: sum.deepFocusSeconds + item.deepFocusSeconds,
  }), { measuredSeconds: 0, scoreSum: 0, deepFocusSeconds: 0 })
  if (totals.measuredSeconds <= 0 || totals.scoreSum < 0) return null

  const efficiency = clamp(totals.scoreSum / totals.measuredSeconds, 0, 100)
  const measuredMinutes = totals.measuredSeconds / 60
  const deepFocusMinutes = totals.deepFocusSeconds / 60
  const volumeScore = 100 * (1 - Math.exp(-deepFocusMinutes / FOCUS_METRIC_V1.fullDayMinutes))
  const baseScore = efficiency ** FOCUS_METRIC_V1.efficiencyExponent *
    volumeScore ** FOCUS_METRIC_V1.volumeExponent
  const volumeQualification = Math.min(1, Math.sqrt(measuredMinutes / FOCUS_METRIC_V1.fullDayMinutes))
  const rawScore = clamp(baseScore * volumeQualification, 1, 100)

  return {
    score: Math.round(rawScore),
    rawScore,
    scoreSum: totals.scoreSum,
    efficiency: Math.round(efficiency),
    measuredSeconds: totals.measuredSeconds,
    deepFocusMinutes: Math.round(deepFocusMinutes * 10) / 10,
    volumeScore,
    volumeQualification,
    sessionCount: contributions.length,
  }
}

function getPeriodWindow(range, offset, now) {
  const safeOffset = Math.min(0, Number.isFinite(offset) ? Math.trunc(offset) : 0)
  if (range === 'day') {
    const start = addDays(startOfDay(now), safeOffset)
    return { start, endExclusive: addDays(start, 1), safeOffset }
  }
  if (range === 'month') {
    const start = addMonths(startOfMonth(now), safeOffset)
    return { start, endExclusive: addMonths(start, 1), safeOffset }
  }
  if (range === 'year') {
    const start = startOfYear(now)
    start.setFullYear(start.getFullYear() + safeOffset)
    const endExclusive = new Date(start)
    endExclusive.setFullYear(endExclusive.getFullYear() + 1)
    return { start, endExclusive, safeOffset }
  }
  const start = addDays(startOfWeek(now), safeOffset * 7)
  return { start, endExclusive: addDays(start, 7), safeOffset }
}

function formatPeriodTitle(range, start) {
  if (range === 'day') {
    return start.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
  }
  if (range === 'month') return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  if (range === 'year') return String(start.getFullYear())
  const end = addDays(start, 6)
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function currentStreak(days, now) {
  const active = new Set(days.filter(day => day.score > 0).map(day => day.key))
  let cursor = startOfDay(now)
  if (!active.has(localDayKey(cursor))) cursor = addDays(cursor, -1)
  let streak = 0
  while (active.has(localDayKey(cursor))) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
}

function dayDiff(start, end) {
  // Calendar arithmetic via UTC avoids 23/25-hour DST days changing the count.
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  return Math.round((b - a) / DAY_MS)
}

export function buildFocusPeriod(ledger, options = {}) {
  const range = ['day', 'week', 'month', 'year'].includes(options.range) ? options.range : 'week'
  const now = new Date(options.now ?? Date.now())
  const safeNow = Number.isNaN(now.getTime()) ? new Date() : now
  const { start, endExclusive, safeOffset } = getPeriodWindow(range, options.offset, safeNow)
  const safeLedger = ledger?.schemaVersion === 1 && ledger.days ? ledger : emptyFocusLedger()
  const sessionDays = new Set((options.sessions || [])
    .map(session => localDayKey(session?.startedAt ?? session?.timestamp))
    .filter(Boolean))
  const days = []
  const todayKey = localDayKey(safeNow)
  for (let cursor = new Date(start); cursor < endExclusive; cursor = addDays(cursor, 1)) {
    const key = localDayKey(cursor)
    const entry = safeLedger.days[key]
    const calculated = calculateDailyFocus(entry)
    const isFuture = key > todayKey
    const noActivity = !entry && !sessionDays.has(key) && !isFuture
    days.push({
      key,
      date: new Date(cursor),
      label: cursor.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3),
      ...(calculated || (noActivity ? {
        score: 0,
        rawScore: 0,
        scoreSum: 0,
        efficiency: null,
        measuredSeconds: 0,
        deepFocusMinutes: 0,
        volumeScore: 0,
        volumeQualification: 0,
        sessionCount: 0,
        noActivity: true,
      } : {})),
    })
  }

  const scoredDays = days.filter(day => day.score != null)
  const measuredDays = days.filter(day => day.score > 0 && day.sessionCount > 0)
  const rawScore = scoredDays.length
    ? scoredDays.reduce((sum, day) => sum + day.rawScore, 0) / scoredDays.length
    : null
  const measuredSeconds = scoredDays.reduce((sum, day) => sum + day.measuredSeconds, 0)
  const scoreSum = scoredDays.reduce((sum, day) => sum + day.scoreSum, 0)
  const periodEndForCoverage = safeOffset === 0 && safeNow < endExclusive
    ? addDays(startOfDay(safeNow), 1)
    : endExclusive
  const elapsedDays = Math.max(1, dayDiff(start, periodEndForCoverage))

  const priorScores = Object.entries(safeLedger.days)
    .filter(([key]) => key < localDayKey(start))
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([, entry]) => calculateDailyFocus(entry)?.rawScore)
    .filter(Number.isFinite)
    .slice(0, 28)
  const baseline = priorScores.length >= 8 ? Math.round(median(priorScores)) : null

  const allDays = Object.entries(safeLedger.days).map(([key, entry]) => ({
    key,
    score: calculateDailyFocus(entry)?.score ?? null,
  }))

  return {
    range,
    offset: safeOffset,
    title: formatPeriodTitle(range, start),
    start,
    endExclusive,
    days,
    score: rawScore == null ? null : Math.round(rawScore),
    rawScore,
    efficiency: measuredSeconds > 0 ? Math.round(scoreSum / measuredSeconds) : null,
    measuredSeconds,
    deepFocusMinutes: Math.round(scoredDays.reduce((sum, day) => sum + day.deepFocusMinutes, 0) * 10) / 10,
    activeDays: measuredDays.length,
    elapsedDays,
    streak: currentStreak(allDays, safeNow),
    baseline,
    totalMeasuredDays: allDays.filter(day => day.score > 0).length,
    canGoForward: safeOffset < 0,
  }
}
