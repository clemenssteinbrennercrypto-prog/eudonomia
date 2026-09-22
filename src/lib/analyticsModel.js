import { isUsable, calibrate, outcomeFit } from './calibration'
import {
  aggregateAverageFocus,
  aggregateDeepFocusTime,
  aggregateFocusMeasurements,
  sessionAverageFocus,
} from './historyTrend'
import { SCOREABLE_SCORING_VERSIONS } from './focusMetric'
import { analyzeSession } from './sessionAnalysis'
import { describeNextAction } from './sessionAnalysisPresentation'
import { summarizeSessionAlignment } from './sessionIntent'

export const COHORT_SIZE = 8

export function normalizedOutcome(session) {
  if (session?.goalOutcome === 'yes' || session?.goalOutcome === 'partly' || session?.goalOutcome === 'no') {
    return session.goalOutcome
  }
  if (session?.goalAchieved === true) return 'yes'
  if (session?.goalAchieved === false) return 'no'
  return null
}

function timestampOf(session) {
  return Number.isFinite(session?.timestamp) ? session.timestamp : -Infinity
}

/**
 * Analytics comparisons refuse records without an explicit, supported ruler.
 * historyTrend intentionally interprets some pre-version history as V1 for
 * display/migration; cohort claims are stricter because they compare days.
 */
export function knownComparableSessions(sessions = []) {
  const known = (Array.isArray(sessions) ? sessions : [])
    .filter(session => SCOREABLE_SCORING_VERSIONS.includes(session?.attentionScoringVersion))
  if (known.length === 0) return []

  const newest = [...known].sort((a, b) => timestampOf(b) - timestampOf(a))[0]
  return known
    .filter(session => session.attentionScoringVersion === newest.attentionScoringVersion)
    .sort((a, b) => timestampOf(b) - timestampOf(a))
}

function cohortStats(sessions) {
  const outcomes = { yes: 0, partly: 0, no: 0, unrated: 0 }
  for (const session of sessions) outcomes[normalizedOutcome(session) || 'unrated'] += 1
  const ratedCount = outcomes.yes + outcomes.partly + outcomes.no
  const measurement = aggregateFocusMeasurements(sessions)
  const deepFocus = aggregateDeepFocusTime(sessions)
  return {
    sessionCount: sessions.length,
    measuredCount: measurement.sessionCount,
    ratedCount,
    outcomes,
    hitRate: ratedCount >= 3 ? Math.round((outcomes.yes / ratedCount) * 100) : null,
    averageFocus: aggregateAverageFocus(sessions),
    deepFocusSeconds: deepFocus.seconds,
    deepFocusTrackedSessions: deepFocus.trackedSessions,
    measuredSeconds: measurement.measuredSeconds,
    focusedSeconds: measurement.focusedSeconds,
  }
}

export function buildCohortProgress(sessions = []) {
  const comparable = knownComparableSessions(sessions).filter(isUsable)
  const currentSessions = comparable.slice(0, COHORT_SIZE)
  const previousSessions = comparable.slice(COHORT_SIZE, COHORT_SIZE * 2)
  const current = cohortStats(currentSessions)
  const previous = cohortStats(previousSessions)
  const comparisonReady = currentSessions.length === COHORT_SIZE && previousSessions.length === COHORT_SIZE

  return {
    generation: comparable[0]?.attentionScoringVersion ?? null,
    qualifiedCount: comparable.length,
    current,
    previous,
    comparisonReady,
    focusDelta: comparisonReady && current.averageFocus != null && previous.averageFocus != null
      ? current.averageFocus - previous.averageFocus
      : null,
    deepFocusDeltaSeconds: comparisonReady && current.deepFocusSeconds != null && previous.deepFocusSeconds != null
      ? current.deepFocusSeconds - previous.deepFocusSeconds
      : null,
    outcomeDelta: comparisonReady && current.hitRate != null && previous.hitRate != null
      ? current.hitRate - previous.hitRate
      : null,
  }
}

function candidateOutcomeSupport(bestSessions, worstSessions) {
  const best = outcomeFit(bestSessions || [])
  const worst = outcomeFit(worstSessions || [])
  if (!best || !worst) return null
  return {
    bestRate: best.hitRate,
    worstRate: worst.hitRate,
    bestN: best.n,
    worstN: worst.n,
    delta: best.hitRate - worst.hitRate,
  }
}

function bucketCandidate(kind, result, title, prefill = null) {
  if (!result?.best || !result?.worst) return null
  const outcome = candidateOutcomeSupport(result.best.sessions, result.worst.sessions)
  const focusGap = result.best.focusPct - result.worst.focusPct
  return {
    kind,
    source: 'qualified_pattern',
    title,
    hypothesis: `${result.best.label} averaged ${result.best.focusPct}% focus across ${result.best.n} sessions, versus ${result.worst.focusPct}% across ${result.worst.n} ${result.worst.label}. Test whether the same condition helps again.`,
    evidence: { focusGap, best: result.best, worst: result.worst, outcome },
    prefill,
    rank: (outcome && outcome.delta > 0 ? 1000 + outcome.delta : 0) + focusGap + Math.min(20, result.best.n + result.worst.n),
  }
}

function qualifiedExperiment(calibration, usable) {
  if (!calibration.ready) return null
  const candidates = [
    bucketCandidate(
      'workspace',
      calibration.workspace,
      calibration.workspace?.best ? `Repeat ${calibration.workspace.best.label}` : '',
      calibration.workspace?.best ? { workspaceId: String(calibration.workspace.best.id).split(':')[0] } : null,
    ),
    bucketCandidate(
      'time_of_day',
      calibration.timeOfDay,
      calibration.timeOfDay?.best ? `Test the ${calibration.timeOfDay.best.label}` : '',
    ),
    bucketCandidate(
      'weekday',
      calibration.weekday,
      calibration.weekday?.best ? `Test ${calibration.weekday.best.label} again` : '',
    ),
  ].filter(Boolean)

  if (calibration.duration?.shorterIsBetter) {
    const { best, longest } = calibration.duration.shorterIsBetter
    const bestSessions = usable.filter(session => session.plannedDuration === best.minutes)
    const longestSessions = usable.filter(session => session.plannedDuration === longest.minutes)
    const outcome = candidateOutcomeSupport(bestSessions, longestSessions)
    candidates.push({
      kind: 'duration',
      source: 'qualified_pattern',
      title: `Test a ${best.minutes}-minute block`,
      hypothesis: `${best.minutes}-minute sessions averaged ${best.focusPct}% focus (${best.n} sessions), versus ${longest.focusPct}% for ${longest.minutes}-minute blocks (${longest.n}). Test the shorter block once more.`,
      evidence: { focusGap: best.focusPct - longest.focusPct, best, worst: longest, outcome },
      prefill: { duration: best.minutes },
      rank: (outcome && outcome.delta > 0 ? 1000 + outcome.delta : 0) + (best.focusPct - longest.focusPct) + Math.min(20, best.n + longest.n),
    })
  }

  return candidates.sort((a, b) => b.rank - a.rank)[0] || null
}

export function buildNextExperiment(sessions = []) {
  const comparable = knownComparableSessions(sessions)
  const usable = comparable.filter(isUsable)
  const calibration = calibrate(comparable)
  const qualified = qualifiedExperiment(calibration, usable)
  if (qualified) return qualified

  const latestRated = comparable.find(session => normalizedOutcome(session))
  if (latestRated) {
    const priorSessions = comparable.filter(session => session.id !== latestRated.id)
    const analysis = analyzeSession(latestRated, { priorSessions })
    const action = describeNextAction(analysis.nextAction)
    if (action) {
      return {
        kind: 'latest_session',
        source: 'latest_session',
        title: 'Next-session test',
        hypothesis: action,
        evidence: {
          sessionId: latestRated.id,
          conclusionCode: analysis.conclusion?.code ?? null,
          actionCode: analysis.nextAction?.code ?? null,
        },
        prefill: {
          ...(Number.isFinite(latestRated.plannedDuration) ? { duration: latestRated.plannedDuration } : {}),
          ...(latestRated.workspace?.id ? { workspaceId: latestRated.workspace.id } : {}),
        },
      }
    }
  }

  return {
    kind: 'collecting',
    source: 'collecting',
    title: 'Build the evidence base',
    hypothesis: 'Complete a measured session and rate whether you reached the goal. Analytics will stay quiet until it has enough comparable evidence.',
    evidence: { qualifiedCount: usable.length, required: 8 },
    prefill: null,
  }
}

export function buildInterventionSummary(sessions = []) {
  const comparable = knownComparableSessions(sessions)
  const summary = comparable.reduce((summary, session) => {
    const interventions = session.phaseInterventions
    summary.sessions += 1
    summary.gentleReminders += Number.isFinite(interventions?.gentleReminders) ? interventions.gentleReminders : 0
    summary.preDriftNudges += Number.isFinite(interventions?.preDriftNudges) ? interventions.preDriftNudges : 0
    summary.alerts += Number.isFinite(session.distractionEvents)
      ? session.distractionEvents
      : Array.isArray(session.distractionLog) ? session.distractionLog.length : 0
    if (Array.isArray(session.protectionEvents)) {
      summary.protectionTrackedSessions += 1
      summary.protectionEvents += session.protectionEvents.length
    }
    return summary
  }, {
    sessions: 0,
    gentleReminders: 0,
    preDriftNudges: 0,
    alerts: 0,
    protectionEvents: 0,
    protectionTrackedSessions: 0,
  })
  return {
    ...summary,
    protectionEvents: summary.protectionTrackedSessions > 0 ? summary.protectionEvents : null,
  }
}

function quantile(sorted, position) {
  if (!sorted.length) return null
  const index = (sorted.length - 1) * position
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

export function buildFocusDistribution(sessions = []) {
  const values = knownComparableSessions(sessions)
    .map(sessionAverageFocus)
    .filter(value => value != null)
    .sort((a, b) => a - b)
  const bins = [
    { label: '0–19', min: 0, max: 19, count: 0 },
    { label: '20–39', min: 20, max: 39, count: 0 },
    { label: '40–59', min: 40, max: 59, count: 0 },
    { label: '60–79', min: 60, max: 79, count: 0 },
    { label: '80–100', min: 80, max: 100, count: 0 },
  ]
  for (const value of values) {
    const bin = bins.find(item => value >= item.min && value <= item.max)
    if (bin) bin.count += 1
  }
  return {
    values,
    bins,
    count: values.length,
    mean: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    median: values.length ? Math.round(quantile(values, 0.5)) : null,
    q1: values.length ? Math.round(quantile(values, 0.25)) : null,
    q3: values.length ? Math.round(quantile(values, 0.75)) : null,
  }
}

export function buildAnalyticsStory(sessions = []) {
  const safe = Array.isArray(sessions) ? sessions : []
  const comparable = knownComparableSessions(safe)
  const usable = comparable.filter(isUsable)
  return {
    unratedSessions: [...safe]
      .filter(session => !normalizedOutcome(session))
      .sort((a, b) => timestampOf(b) - timestampOf(a)),
    progress: buildCohortProgress(safe),
    experiment: buildNextExperiment(safe),
    interventions: buildInterventionSummary(safe),
    distribution: buildFocusDistribution(safe),
    learning: {
      qualified: usable.length,
      requiredForPatterns: 8,
      requiredForComparison: COHORT_SIZE * 2,
      generation: comparable[0]?.attentionScoringVersion ?? null,
    },
  }
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function facetRows(sessions, keyFor) {
  const buckets = new Map()
  for (const session of sessions) {
    const key = keyFor(session)
    if (!key?.id) continue
    if (!buckets.has(key.id)) buckets.set(key.id, { id: key.id, label: key.label, sessions: [], focus: [] })
    const bucket = buckets.get(key.id)
    bucket.sessions.push(session)
    const average = sessionAverageFocus(session)
    if (average != null) bucket.focus.push(average)
  }
  return [...buckets.values()].map(bucket => {
    const outcomes = { yes: 0, partly: 0, no: 0, unrated: 0 }
    for (const session of bucket.sessions) outcomes[normalizedOutcome(session) || 'unrated'] += 1
    const rated = outcomes.yes + outcomes.partly + outcomes.no
    return {
      id: bucket.id,
      label: bucket.label,
      sessions: bucket.sessions.length,
      measured: bucket.focus.length,
      averageFocus: bucket.focus.length ? Math.round(mean(bucket.focus)) : null,
      rated,
      outcomeRate: rated >= 3 ? Math.round((outcomes.yes / rated) * 100) : null,
      outcomes,
    }
  }).sort((a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label))
}

function partOfDay(session) {
  const date = new Date(session.timestamp)
  if (Number.isNaN(date.getTime())) return null
  const hour = date.getHours()
  if (hour >= 6 && hour < 9) return { id: 'early', label: 'Early morning' }
  if (hour >= 9 && hour < 12) return { id: 'morning', label: 'Late morning' }
  if (hour >= 12 && hour < 15) return { id: 'midday', label: 'Midday' }
  if (hour >= 15 && hour < 18) return { id: 'afternoon', label: 'Afternoon' }
  if (hour >= 18 && hour < 22) return { id: 'evening', label: 'Evening' }
  return { id: 'night', label: 'Late night' }
}

export function buildScoreComponentSummary(sessions = []) {
  const components = new Map()
  let traceSamples = 0
  let tracedSessions = 0
  for (const session of sessions) {
    let sessionTraced = false
    for (const sample of Array.isArray(session.timeline) ? session.timeline : []) {
      if (!sample?.scoreTrace?.version || !sample.scoreTrace.components) continue
      traceSamples += 1
      sessionTraced = true
      for (const [id, delta] of Object.entries(sample.scoreTrace.components)) {
        if (!Number.isFinite(delta)) continue
        const current = components.get(id) || { id, activeSamples: 0, totalDelta: 0, positiveSamples: 0, negativeSamples: 0 }
        current.activeSamples += 1
        current.totalDelta += delta
        if (delta > 0) current.positiveSamples += 1
        if (delta < 0) current.negativeSamples += 1
        components.set(id, current)
      }
    }
    if (sessionTraced) tracedSessions += 1
  }
  return {
    tracedSessions,
    traceSamples,
    components: [...components.values()]
      .map(component => ({
        ...component,
        averageDeltaWhenActive: component.activeSamples
          ? Math.round((component.totalDelta / component.activeSamples) * 10) / 10
          : null,
        activeSharePct: traceSamples ? Math.round((component.activeSamples / traceSamples) * 100) : 0,
      }))
      .sort((a, b) => Math.abs(b.totalDelta) - Math.abs(a.totalDelta)),
  }
}

function interventionComparison(sessions, hasIntervention, isTracked = () => true) {
  const tracked = sessions.filter(isTracked)
  const withIntervention = tracked.filter(hasIntervention)
  const withoutIntervention = tracked.filter(session => !hasIntervention(session))
  const withStats = cohortStats(withIntervention)
  const withoutStats = cohortStats(withoutIntervention)
  const focusReady = withStats.measuredCount >= 3 && withoutStats.measuredCount >= 3 &&
    withStats.averageFocus != null && withoutStats.averageFocus != null
  const outcomeReady = withStats.ratedCount >= 3 && withoutStats.ratedCount >= 3
  return {
    with: withStats,
    without: withoutStats,
    focusDelta: focusReady ? withStats.averageFocus - withoutStats.averageFocus : null,
    outcomeDelta: outcomeReady && withStats.hitRate != null && withoutStats.hitRate != null
      ? withStats.hitRate - withoutStats.hitRate
      : null,
  }
}

export function buildExplorerSummary(sessions = []) {
  const comparable = knownComparableSessions(sessions)
  const distribution = buildFocusDistribution(comparable)
  const outcomes = { yes: 0, partly: 0, no: 0, unrated: 0 }
  const phases = {}
  const activity = {}
  let activeSeconds = 0
  let measuredSeconds = 0
  let trackingFaults = 0
  let watchedOutput = 0
  let outputMoved = 0

  for (const session of comparable) {
    outcomes[normalizedOutcome(session) || 'unrated'] += 1
    activeSeconds += Number.isFinite(session.actualSeconds) ? Math.max(0, session.actualSeconds) : 0
    measuredSeconds += Number.isFinite(session.measuredSeconds) ? Math.max(0, session.measuredSeconds) : 0
    if (session.trackingFaulted) trackingFaults += 1
    for (const [phase, seconds] of Object.entries(session.focusPhases?.seconds || {})) {
      if (Number.isFinite(seconds) && seconds > 0) phases[phase] = (phases[phase] || 0) + seconds
    }
    const alignment = summarizeSessionAlignment(session.activityAlignment, session.actualSeconds || 0)
    for (const [kind, seconds] of Object.entries(alignment.secondsByKind || {})) {
      if (Number.isFinite(seconds) && seconds > 0) activity[kind] = (activity[kind] || 0) + seconds
    }
    if (session.outputEvidence?.watched) {
      watchedOutput += 1
      const output = session.outputEvidence
      if ((output.filesChanged || 0) + (output.filesCreated || 0) + (output.commits || 0) > 0) outputMoved += 1
    }
  }

  const trend = [...comparable].reverse().map(session => ({
    id: session.id,
    timestamp: session.timestamp,
    averageFocus: sessionAverageFocus(session),
    outcome: normalizedOutcome(session),
    durationMinutes: Number.isFinite(session.actualSeconds) ? Math.round(session.actualSeconds / 60) : null,
  }))

  return {
    generation: comparable[0]?.attentionScoringVersion ?? null,
    sessionCount: comparable.length,
    distribution,
    outcomes,
    quality: {
      measuredSessions: distribution.count,
      unmeasuredSessions: comparable.length - distribution.count,
      trackingFaults,
      activeSeconds,
      measuredSeconds,
      coveragePct: activeSeconds > 0 ? Math.round((measuredSeconds / activeSeconds) * 100) : null,
    },
    phases,
    activity,
    output: { watchedSessions: watchedOutput, movedSessions: outputMoved },
    interventions: buildInterventionSummary(comparable),
    interventionComparisons: {
      alerts: interventionComparison(
        comparable,
        session => Number.isFinite(session.distractionEvents)
          ? session.distractionEvents > 0
          : session.distractionLog.length > 0,
        session => Number.isFinite(session.distractionEvents) || Array.isArray(session.distractionLog),
      ),
      nudges: interventionComparison(comparable, session =>
        (session.phaseInterventions?.gentleReminders || 0) + (session.phaseInterventions?.preDriftNudges || 0) > 0,
      session => session.phaseInterventions != null),
      protection: interventionComparison(comparable, session =>
        session.protectionEvents.length > 0,
      session => Array.isArray(session.protectionEvents)),
    },
    scoreComponents: buildScoreComponentSummary(comparable),
    trend,
    facets: {
      workspace: facetRows(comparable, session => session.workspace?.id
        ? { id: `${session.workspace.id}:${session.workspace.revision ?? 0}`, label: session.workspace.name || session.workspace.id }
        : null),
      energy: facetRows(comparable, session => session.energyLevel
        ? { id: session.energyLevel, label: session.energyLevel }
        : null),
      timeOfDay: facetRows(comparable, partOfDay),
      duration: facetRows(comparable, session => Number.isFinite(session.plannedDuration) && session.plannedDuration > 0
        ? { id: String(session.plannedDuration), label: `${session.plannedDuration} min planned` }
        : null),
    },
  }
}

/**
 * A portable, derived Analytics report. This is intentionally separate from
 * the lossless archive: it captures the currently selected evidence and its
 * refusal states without pretending to be a backup of every raw event.
 */
export function buildAnalyticsExport(sessions = [], options = {}) {
  const comparable = knownComparableSessions(sessions)
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt || new Date().toISOString(),
    scope: options.scope || {},
    generation: comparable[0]?.attentionScoringVersion ?? null,
    summary: buildExplorerSummary(comparable),
    cohortProgress: buildCohortProgress(comparable),
    sessions: comparable.map(session => ({
      id: session.id,
      timestamp: session.timestamp,
      task: session.task || '',
      workspace: session.workspace
        ? { id: session.workspace.id, name: session.workspace.name, revision: session.workspace.revision }
        : null,
      plannedDuration: session.plannedDuration ?? null,
      actualSeconds: session.actualSeconds ?? null,
      measuredSeconds: session.measuredSeconds ?? null,
      averageFocus: sessionAverageFocus(session),
      goalOutcome: normalizedOutcome(session),
      attentionScoringVersion: session.attentionScoringVersion,
      scoreTraceVersion: session.scoreTraceVersion ?? null,
      analysisVersion: session.analysisSnapshot?.version ?? null,
      protectionEvents: Array.isArray(session.protectionEvents) ? session.protectionEvents.length : null,
    })),
  }
}
