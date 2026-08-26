import { FOCUSED_SCORE, FLOW_SCORE } from './attention'
import { ATTENTION_SCORING_VERSION, FOCUS_METRIC_V1, buildFocusPeriod } from './focusMetric'

const RANGE_MS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
}

function startOfRange(range, now) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (range === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  if (range === 'month') start.setDate(1)
  return start.getTime()
}

function sessionStart(session) {
  if (Number.isFinite(session?.startedAt)) return session.startedAt
  const end = Number.isFinite(session?.timestamp) ? session.timestamp : null
  const duration = Number.isFinite(session?.actualSeconds) ? session.actualSeconds * 1000 : 0
  return end == null ? null : end - duration
}

export function buildAttentionField(sessions, { range = 'day', now = Date.now(), bins = 96 } = {}) {
  const safeRange = ['day', 'week', 'month'].includes(range) ? range : 'day'
  const start = startOfRange(safeRange, now)
  const nominalEnd = safeRange === 'month'
    ? new Date(new Date(start).getFullYear(), new Date(start).getMonth() + 1, 1).getTime()
    : start + RANGE_MS[safeRange]
  const end = nominalEnd
  const width = Math.max(1, nominalEnd - start)
  const safeBins = Math.max(12, Math.min(160, Math.trunc(bins) || 96))
  const buckets = Array.from({ length: safeBins }, () => ({ scores: [], active: false }))

  for (const session of sessions || []) {
    if (session?.attentionScoringVersion !== ATTENTION_SCORING_VERSION) continue
    const sessionStartMs = sessionStart(session)
    if (!Number.isFinite(sessionStartMs)) continue
    const durationMs = Math.max(0, (session.actualSeconds || 0) * 1000)
    const sessionEndMs = sessionStartMs + durationMs
    if (sessionEndMs < start || sessionStartMs > Math.min(now, end)) continue

    const firstBin = Math.max(0, Math.floor(((sessionStartMs - start) / width) * safeBins))
    const lastBin = Math.min(safeBins - 1, Math.floor(((sessionEndMs - start) / width) * safeBins))
    for (let i = firstBin; i <= lastBin; i++) buckets[i].active = true

    for (const point of session.timeline || []) {
      if (!Number.isFinite(point?.second) || !Number.isFinite(point?.score)) continue
      const pointTime = sessionStartMs + point.second * 1000
      if (pointTime < start || pointTime > Math.min(now, end)) continue
      const index = Math.min(safeBins - 1, Math.max(0, Math.floor(((pointTime - start) / width) * safeBins)))
      buckets[index].scores.push(point.score)
    }
  }

  return buckets.map((bucket, index) => {
    const bucketStart = start + (index / safeBins) * width
    if (bucketStart >= now) return { index, timestamp: bucketStart, state: 'future', score: null }
    if (bucket.scores.length === 0) {
      return { index, timestamp: bucketStart, state: bucket.active ? 'no-signal' : 'inactive', score: null }
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

export function buildDashboardData({ ledger, sessions, focusConfig, focusModeEnabled, nativeStatus, scoreRange = 'day', fieldRange = 'day', now = Date.now() }) {
  const period = buildFocusPeriod(ledger, {
    range: scoreRange === 'week' ? 'week' : 'day',
    now,
    sessions,
  })
  const blockedCount = focusConfig?.distractionApps?.length || 0
  const blockedDomainCount = focusConfig?.distractionDomains?.length || 0
  const protection = !focusModeEnabled
    ? { state: 'off', label: 'Off', detail: 'Focus mode disabled' }
    : blockedCount + blockedDomainCount === 0
      ? { state: 'empty', label: 'Not configured', detail: 'Choose apps and websites' }
      : nativeStatus?.checked !== true
        ? { state: 'checking', label: 'Checking', detail: 'Verifying native protection' }
        : nativeStatus.connected !== true
          ? { state: 'disconnected', label: 'Not connected', detail: 'Native protection is unavailable' }
          : blockedDomainCount > 0 && nativeStatus.helperInstalled !== true
            ? { state: 'helper', label: 'Setup required', detail: 'Install the website blocking helper' }
            : {
          state: 'ready',
          label: 'Ready',
          detail: `${blockedCount} ${blockedCount === 1 ? 'app' : 'apps'} · ${blockedDomainCount} ${blockedDomainCount === 1 ? 'website' : 'websites'}`,
              }

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
    attention: buildAttentionField(sessions, { range: fieldRange, now }),
    protection,
    recentSessions,
  }
}
