// The shared, versioned session-analysis model.
//
// This is the single source of truth for "what happened in this session and
// what should you do next" — computed once, stored as a snapshot, and rendered
// identically whether you're looking at it right after the session or reopening
// it from history later. It replaces the analysis logic that used to live
// inline in EndScreen.jsx (makeOutcomeInsight/makeRecommendations/makeDebrief).
//
// Deliberately NOT here: prose. This module returns codes and numeric evidence
// only; `sessionAnalysisPresentation.js` turns a code into a sentence. Keeping
// that split means the analysis itself stays trivially unit-testable and never
// needs a snapshot test against wording.
//
// Deliberately NOT here: any model call. No import of sessionVerdict.js or
// modelClient.js — this is pure, deterministic, local computation. The AI
// verdict feature is a separate, still-isolated concern for future AI
// Companion work.

import { isComparableFocusGeneration, sessionAverageFocus, sessionFocusMeasurement, sessionFocusPct } from './historyTrend'
import { summarizeSessionAlignment } from './sessionIntent'
import { calibrate } from './calibration'

export const SESSION_ANALYSIS_VERSION = 1

/** Below this a session is noise, not evidence — same bar as calibration.js's
 *  `isUsable` and sessionVerdict.js's MIN_SESSION_SECONDS. Below it we still
 *  show every measured fact, we just refuse to draw a conclusion from them. */
export const MIN_SESSION_SECONDS_FOR_CONCLUSION = 120

/** Some activity must actually have been observed before the facts include an
 *  activity-alignment breakdown — otherwise a handful of seconds of noise reads
 *  as a confident percentage breakdown. */
const MIN_OBSERVED_SECONDS_FOR_ACTIVITY_FACTS = 60

function outcomeFromLegacy(goalAchieved) {
  if (goalAchieved === true) return 'yes'
  if (goalAchieved === false) return 'no'
  return null
}

function normalizeOutcome(value) {
  return value === 'yes' || value === 'partly' || value === 'no' ? value : null
}

// One ruler for everyone, every day. Only ever called once measurement is
// known-scored and known-compatible — see buildConclusion.
function classifyFocusBand(focusPct) {
  if (focusPct >= 70) return 'high'
  if (focusPct < 50) return 'low'
  return 'mixed'
}

// Conclusion codes: the factual read of "what happened", keyed by focus band ×
// reported outcome. Ported 1:1 from EndScreen.jsx's old makeOutcomeInsight
// matrix. `mixed` here means a real measured 50-69% — NOT "not measured", which
// gets its own refusal codes below instead of falling into this table.
const CONCLUSION_MATRIX = {
  high: { no: 'HIGH_FOCUS_GOAL_MISSED', partly: 'HIGH_FOCUS_PARTIAL', yes: 'HIGH_FOCUS_GOAL_MET' },
  low: { yes: 'LOW_FOCUS_GOAL_MET', no: 'LOW_FOCUS_GOAL_MISSED', partly: 'LOW_FOCUS_PARTIAL' },
  mixed: { yes: 'MIXED_FOCUS_GOAL_MET', partly: 'MIXED_FOCUS_PARTIAL', no: 'MIXED_FOCUS_GOAL_MISSED' },
}

// Next-action codes for the same band × outcome matrix. Ported from the
// `recommendation` field of the old makeOutcomeInsight branches. Used both as
// the top-priority action when there's a real high/low signal, and as the
// generic fallback (band forced to 'mixed') when there isn't — see
// buildNextAction for why the two roles differ.
const ACTION_MATRIX = {
  high: { no: 'SPLIT_SCOPE_SMALLER', partly: 'DEFINE_THINNER_FINISH_LINE', yes: 'REUSE_SETUP' },
  low: { yes: 'RESERVE_FOR_LIGHT_ENERGY', no: 'SHORTEN_SCOPE_AND_FIRST_ACTION', partly: 'TRY_SMALLER_TARGET_LOWER_INTERRUPTION' },
  mixed: { yes: 'REMOVE_LARGEST_DRIFT_SOURCE', partly: 'MAKE_CRITERION_SMALLER_AND_OBSERVABLE', no: 'RESTART_SMALLER_OUTPUT_OR_ENVIRONMENT' },
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item)
    if (!key) return acc
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

function dominantEntry(counts = {}) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || null
}

function getLowestStretch(timeline = []) {
  if (!Array.isArray(timeline) || timeline.length === 0) return null
  const sorted = [...timeline].sort((a, b) => (a.second || 0) - (b.second || 0))
  const windowSize = Math.min(6, sorted.length)
  let best = null
  for (let i = 0; i <= sorted.length - windowSize; i += 1) {
    const slice = sorted.slice(i, i + windowSize)
    const avg = Math.round(slice.reduce((sum, pt) => sum + (pt.score ?? 0), 0) / slice.length)
    if (!best || avg < best.avg) {
      best = { avg, start: slice[0].second || 0, end: slice[slice.length - 1].second || 0 }
    }
  }
  return best
}

function buildMeasurement(session) {
  const actualSeconds = Number.isFinite(session.actualSeconds) ? session.actualSeconds : 0
  const measurement = sessionFocusMeasurement(session)
  const scored = measurement != null
  const scoringVersion = session.attentionScoringVersion ?? null
  const measuredSeconds = measurement?.measuredSeconds ?? null
  const coveragePct = measuredSeconds != null && actualSeconds > 0
    ? Math.round((measuredSeconds / actualSeconds) * 100)
    : null

  return {
    scored,
    scoringVersion,
    accumulationVersion: session.attentionAccumulationVersion ?? null,
    // Whether this session's focus number can be read against the thresholds
    // the conclusion codes use. Delegated to historyTrend so there is one
    // definition of "same ruler": a missing version is pre-versioning V1 and
    // comparable, while the native V2 ruler is deliberately held out of
    // cross-session reads until it is promoted.
    compatible: isComparableFocusGeneration(session),
    measurementSource: session.attentionMeasurementSource ?? null,
    actualSeconds,
    measuredSeconds,
    coveragePct,
    focusedSeconds: measurement?.focusedSeconds ?? null,
    // The headline figure: mean attention over the measured time.
    averageFocus: sessionAverageFocus(session),
    // Kept alongside it as a secondary detail rather than dropped — it is a
    // genuinely different question and Details still reports it.
    aboveThresholdPct: sessionFocusPct(session),
  }
}

function buildFacts(session, measurement) {
  const alignment = summarizeSessionAlignment(session.activityAlignment, measurement.actualSeconds)
  const activity = alignment.observedSeconds >= MIN_OBSERVED_SECONDS_FOR_ACTIVITY_FACTS ? alignment : null

  const evidence = session.outputEvidence
  const output = evidence?.watched ? {
    filesChanged: evidence.filesChanged || 0,
    filesCreated: evidence.filesCreated || 0,
    bytesAdded: evidence.bytesAdded || 0,
    commits: evidence.commits || 0,
    linesAdded: evidence.linesAdded || 0,
    linesRemoved: evidence.linesRemoved || 0,
    changedNames: evidence.changedNames || [],
  } : null

  return {
    intent: { task: session.task || '', goal: session.goal || '' },
    duration: { actualSeconds: measurement.actualSeconds, plannedDuration: session.plannedDuration || 0 },
    coverage: {
      measuredSeconds: measurement.measuredSeconds,
      actualSeconds: measurement.actualSeconds,
      coveragePct: measurement.coveragePct,
    },
    phases: {
      seconds: session.focusPhases?.seconds || {},
      dominant: session.focusPhases?.dominant || null,
    },
    drift: {
      preDriftEvents: session.preDriftEvents || 0,
      preDriftSeconds: session.preDriftSeconds || 0,
      alertCount: session.distractionEvents || 0,
    },
    activity,
    output,
    workspace: session.workspace
      ? { id: session.workspace.id, name: session.workspace.name, revision: session.workspace.revision }
      : null,
    energyLevel: session.energyLevel || null,
  }
}

function buildBaseline(priorSessions) {
  const c = calibrate(priorSessions)
  return { sessionsAnalysed: c.sessionsAnalysed, ready: c.ready, needMore: c.needMore }
}

// The factual read. Refuses a focus-based claim whenever focus wasn't
// genuinely measured, or was measured under a scoring version this build no
// longer trusts to mean the same thing — the outcome can still be named, but
// never dressed up as a focus conclusion it isn't.
function buildConclusion(measurement, goalOutcome) {
  if (!measurement.scored) {
    return { code: 'NOT_MEASURED', evidence: { outcome: goalOutcome } }
  }
  if (!measurement.compatible) {
    return {
      code: 'SCORING_VERSION_INCOMPATIBLE',
      evidence: { outcome: goalOutcome, scoringVersion: measurement.scoringVersion },
    }
  }
  const band = classifyFocusBand(measurement.averageFocus)
  return { code: CONCLUSION_MATRIX[band][goalOutcome], evidence: { focusPct: measurement.averageFocus, outcome: goalOutcome } }
}

// Exactly one next action — the spec's hardest constraint relative to the old
// makeRecommendations, which collected up to three. Priority order:
//
//   1. A specific, evidence-backed outcome read (real high/low focus band).
//   2-11. Situational behavioral signals, most costly first (ported from the
//      old independent `if` checks, each of which could previously coexist).
//   12. The generic outcome read (band forced to 'mixed' — covers a genuinely
//      mixed 50-69% band AND an unmeasured/incompatible session, exactly the
//      cases the old code's fallthrough branches covered).
//   13. Ultimate fallback when nothing at all stood out.
//
// Note this promotes the generic outcome-derived line from "always first" (as
// it was in the old code, unshifted ahead of everything else) to "last resort
// before the final fallback". Keeping it first here would make it always win
// once an outcome exists, silently making every situational code below
// unreachable — the opposite of what "exactly one, evidence-based" is for.
function buildNextAction({ session, measurement, goalOutcome, facts }) {
  const actualSeconds = measurement.actualSeconds
  const phaseSeconds = facts.phases.seconds || {}
  const alignment = summarizeSessionAlignment(session.activityAlignment, actualSeconds)
  const { preDriftEvents, preDriftSeconds } = facts.drift
  const distractionLog = Array.isArray(session.distractionLog) ? session.distractionLog : []
  const topDistraction = dominantEntry(countBy(distractionLog, ev => ev.reason))
  const lowestStretch = getLowestStretch(session.timeline)
  const phaseInterventions = session.phaseInterventions || null
  const focusPct = measurement.averageFocus

  const phaseTotal = Object.values(phaseSeconds).reduce((sum, seconds) => sum + seconds, 0)
  const pct = (phase) => phaseTotal > 0 ? ((phaseSeconds[phase] || 0) / phaseTotal) * 100 : 0
  const fadeDriftSeconds = (phaseSeconds.fade || 0) + (phaseSeconds.drift || 0)
  const recoverySeconds = phaseSeconds.recovery || 0
  const lockInSeconds = phaseSeconds.lock_in || 0
  const rampSeconds = phaseSeconds.ramp || 0
  const interventionCount = (phaseInterventions?.gentleReminders || 0) + (phaseInterventions?.preDriftNudges || 0)

  const measuredBand = measurement.scored && measurement.compatible && focusPct != null ? classifyFocusBand(focusPct) : 'mixed'
  if (measuredBand !== 'mixed') {
    return { code: ACTION_MATRIX[measuredBand][goalOutcome], evidence: { outcome: goalOutcome, band: measuredBand } }
  }

  if (actualSeconds < 180) {
    return { code: 'RUN_LONGER_NEXT_TIME', evidence: { actualSeconds } }
  }
  if (alignment.observedSeconds >= 60 && alignment.driftPct >= 30) {
    return { code: 'TIGHTEN_TASK_OR_APP_LIST', evidence: { driftPct: alignment.driftPct, observedSeconds: alignment.observedSeconds } }
  }
  if ((phaseSeconds.arrival || 0) > 120 && rampSeconds < 60) {
    return { code: 'START_WITH_SMALLER_FIRST_ACTION', evidence: { arrivalSeconds: phaseSeconds.arrival || 0, rampSeconds } }
  }
  if (preDriftEvents >= 2 || preDriftSeconds >= 45) {
    return { code: 'TREAT_FIRST_DRIFT_CUE_AS_INTERVENTION', evidence: { preDriftEvents, preDriftSeconds } }
  }
  if (pct('lock_in') >= 35 && fadeDriftSeconds < 60) {
    return { code: 'REPEAT_SETUP', evidence: { lockInPct: Math.round(pct('lock_in')), fadeDriftSeconds } }
  }
  if (lockInSeconds >= 90 && fadeDriftSeconds >= 90) {
    return { code: 'END_SOONER_AFTER_LOCKIN', evidence: { lockInSeconds, fadeDriftSeconds } }
  }
  if (recoverySeconds >= 120) {
    return { code: 'USE_DELIBERATE_RECOVERY_MINUTE', evidence: { recoverySeconds } }
  }
  if (topDistraction?.[0] === 'distraction_app') {
    return { code: 'REMOVE_DISTRACTION_APP', evidence: { count: topDistraction[1] } }
  }
  if (topDistraction?.[0] === 'phone') {
    return { code: 'MOVE_PHONE_AWAY', evidence: { count: topDistraction[1] } }
  }
  if (topDistraction?.[0] === 'yawn' || topDistraction?.[0] === 'prolonged') {
    return { code: 'ADDRESS_FATIGUE_SIGNALS', evidence: { reason: topDistraction[0], count: topDistraction[1] } }
  }
  if (lowestStretch && lowestStretch.avg < 55 && fadeDriftSeconds < 60 && alignment.driftPct < 20) {
    return { code: 'WATCH_SPECIFIC_TIMESTAMP_RANGE', evidence: { start: lowestStretch.start, end: lowestStretch.end, avg: lowestStretch.avg } }
  }
  if (interventionCount > 0 && preDriftEvents === 0 && focusPct >= 70) {
    return { code: 'KEEP_GENTLE_REMINDERS_ON', evidence: { interventionCount } }
  }
  if (goalOutcome) {
    return { code: ACTION_MATRIX.mixed[goalOutcome], evidence: { outcome: goalOutcome, band: 'mixed' } }
  }
  return { code: 'KEEP_STRUCTURE_NO_DOMINANT_ISSUE', evidence: {} }
}

/**
 * Analyze one session against its own record plus (optionally) prior sessions
 * for baseline qualification. Pure — takes history as an argument instead of
 * reading storage, so callers control what "prior" means (and tests don't need
 * to fake a storage layer). Called again whenever a historical outcome or
 * reflection edit needs to regenerate the persisted snapshot.
 */
export function analyzeSession(session, { priorSessions = [] } = {}) {
  const s = session || {}
  const measurement = buildMeasurement(s)
  const facts = buildFacts(s, measurement)
  const baseline = buildBaseline(priorSessions)
  const goalOutcome = normalizeOutcome(s.goalOutcome ?? outcomeFromLegacy(s.goalAchieved))

  const base = { version: SESSION_ANALYSIS_VERSION, measurement, baseline, facts }

  if (!goalOutcome) {
    return { ...base, status: 'awaiting_outcome', goalOutcome: null, conclusion: null, nextAction: null }
  }
  if (measurement.actualSeconds < MIN_SESSION_SECONDS_FOR_CONCLUSION) {
    return { ...base, status: 'facts_only', goalOutcome, conclusion: null, nextAction: null }
  }

  const conclusion = buildConclusion(measurement, goalOutcome)
  const nextAction = buildNextAction({ session: s, measurement, goalOutcome, facts })
  return { ...base, status: 'ready', goalOutcome, conclusion, nextAction }
}
