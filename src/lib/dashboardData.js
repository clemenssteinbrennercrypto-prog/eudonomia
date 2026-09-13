import { FOCUSED_SCORE, FLOW_SCORE } from './attention'
import { FOCUS_METRIC_V1, SCOREABLE_SCORING_VERSIONS, buildFocusPeriod, getFocusPeriodWindow } from './focusMetric'
import { activeFocusGeneration, focusGenerationOf } from './historyTrend'
import { sessionEndedAt, sessionPauseIntervals, sessionStartedAt, timelineWallSecond } from './sessionTiming'
import { getProtectionReadiness } from './protectionReadiness'

export function buildAttentionField(sessions, { range = 'day', offset = 0, periodStart = null, now = Date.now(), bins = 96 } = {}) {
  const safeRange = ['day', 'week', 'month'].includes(range) ? range : 'day'
  const safeNow = new Date(now)
  const windowNow = Number.isNaN(safeNow.getTime()) ? new Date() : safeNow
  const nowMs = windowNow.getTime()
  const requestedStart = new Date(periodStart)
  const hasExplicitStart = periodStart != null && !Number.isNaN(requestedStart.getTime())
  const periodWindow = getFocusPeriodWindow(
    safeRange,
    hasExplicitStart ? 0 : offset,
    hasExplicitStart ? requestedStart : windowNow
  )
  const start = periodWindow.start.getTime()
  const endExclusive = periodWindow.endExclusive.getTime()
  const width = Math.max(1, endExclusive - start)
  const measurementEnd = Math.min(nowMs, endExclusive)
  const safeBins = Math.max(12, Math.min(160, Math.trunc(bins) || 96))
  const buckets = Array.from({ length: safeBins }, () => ({ scores: [], active: false, paused: false }))
  const scoreableSessions = (Array.isArray(sessions) ? sessions : []).filter(session =>
    SCOREABLE_SCORING_VERSIONS.includes(session?.attentionScoringVersion))
  const activeGeneration = activeFocusGeneration(scoreableSessions)

  for (const session of scoreableSessions) {
    // The field is a comparison just like Trends and Patterns: show the ruler
    // in current use, but never average coordinates measured by two different
    // camera generations into one colour cell.
    if (focusGenerationOf(session) !== activeGeneration) continue
    const sessionStartMs = sessionStartedAt(session)
    if (!Number.isFinite(sessionStartMs)) continue
    const sessionEndMs = sessionEndedAt(session)
    if (!Number.isFinite(sessionEndMs) || sessionEndMs < sessionStartMs) continue
    if (sessionEndMs <= start || sessionStartMs >= measurementEnd) continue

    const firstBin = Math.max(0, Math.floor(((sessionStartMs - start) / width) * safeBins))
    const lastBin = Math.min(safeBins - 1, Math.floor(((sessionEndMs - start) / width) * safeBins))
    for (let i = firstBin; i <= lastBin; i++) buckets[i].active = true

    for (const pause of sessionPauseIntervals(session)) {
      for (let i = firstBin; i <= lastBin; i++) {
        const binStart = start + (i / safeBins) * width
        const binEnd = start + ((i + 1) / safeBins) * width
        if (pause.startedAt < binEnd && pause.endedAt > binStart) buckets[i].paused = true
      }
    }

    for (const point of session.timeline || []) {
      if (!Number.isFinite(point?.second) || !Number.isFinite(point?.score)) continue
      const pointTime = sessionStartMs + timelineWallSecond(point) * 1000
      if (pointTime < start || pointTime >= measurementEnd) continue
      const index = Math.min(safeBins - 1, Math.max(0, Math.floor(((pointTime - start) / width) * safeBins)))
      buckets[index].scores.push(point.score)
    }
  }

  return buckets.map((bucket, index) => {
    const bucketStart = start + (index / safeBins) * width
    if (bucketStart >= nowMs) return { index, timestamp: bucketStart, state: 'future', score: null }
    if (bucket.scores.length === 0) {
      return { index, timestamp: bucketStart, state: bucket.paused ? 'paused' : bucket.active ? 'no-signal' : 'inactive', score: null }
    }
    const score = Math.round(bucket.scores.reduce((sum, value) => sum + value, 0) / bucket.scores.length)
    const state = score >= FLOW_SCORE ? 'strong' : score >= FOCUSED_SCORE ? 'focused' : 'drift'
    return { index, timestamp: bucketStart, state, score }
  })
}

function outcomeLabel(session) {
  if (session?.goalOutcome === 'yes' || session?.goalAchieved === true) return 'Done'
  if (session?.goalOutcome === 'partly') return 'Partial'
  if (session?.goalOutcome === 'no' || session?.goalAchieved === false) return 'Missed'
  return 'Unset'
}

export function buildDashboardData({ ledger, sessions, focusConfig, focusModeEnabled, nativeStatus, range = 'day', offset = 0, periodStart = null, now = Date.now() }) {
  const period = buildFocusPeriod(ledger, {
    range: ['day', 'week', 'month'].includes(range) ? range : 'day',
    offset,
    periodStart,
    now,
    sessions,
  })
  const readiness = getProtectionReadiness({ enabled: focusModeEnabled, setup: focusConfig, nativeStatus })
  const { appCount, websiteCount } = readiness
  const protection = ({
    off: { state: 'off', label: 'Off', detail: 'Focus mode disabled' },
    empty: { state: 'empty', label: 'Not configured', detail: 'Choose apps and websites' },
    checking: { state: 'checking', label: 'Checking', detail: 'Verifying native protection' },
    disconnected: { state: 'disconnected', label: 'Not connected', detail: 'Native protection is unavailable' },
    helper: { state: 'helper', label: 'Setup required', detail: 'Install the website blocking helper' },
    ready: {
      state: 'ready',
      label: 'Ready',
      detail: `${readiness.strictMode ? 'Strict · ' : ''}${appCount} ${appCount === 1 ? 'app' : 'apps'} · ${websiteCount} ${websiteCount === 1 ? 'website' : 'websites'}`,
    },
  })[readiness.state]

  const recentSessions = (sessions || []).slice(0, 3).map(session => ({
    id: session.id,
    task: session.task || 'Untitled session',
    durationMinutes: Math.max(0, Math.round((session.actualSeconds || 0) / 60)),
    efficiency: session?.focusMetricVersion === FOCUS_METRIC_V1.version &&
      session?.focusMetricRejection == null && Number.isFinite(session?.sessionEfficiency) &&
      session.sessionEfficiency >= 0 && session.sessionEfficiency <= 100
      ? session.sessionEfficiency
      : null,
    outcome: outcomeLabel(session),
  }))

  return {
    period,
    attention: buildAttentionField(sessions, { range, offset, periodStart, now }),
    protection,
    recentSessions,
  }
}
