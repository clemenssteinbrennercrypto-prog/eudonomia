// A WebView timer is only a wake-up signal, never a clock. macOS may throttle
// background callbacks while the user works in another app, so one callback
// can represent more than one real second. Count the elapsed wall time only
// while a recent camera frame proves that the signal is still alive.

import { FLOW_SCORE, GOOD_STREAK_SCORE, classifyFocusPhase, isFocusedSecond } from './attention'

export const ATTENTION_ACCUMULATION_VERSION = 2
// Exact, forward-only time in the live Flow state. This is deliberately a
// separate ruler from `focusedSeconds` (score >= 40) and the V1 weighted
// `deepFocusSeconds` estimate. Historical sessions without this accumulator
// stay unknown rather than being relabelled after the fact.
export const DEEP_FOCUS_TIME_VERSION = 1
export const MAX_MEASUREMENT_SPAN_MS = 3_000
export const FLOW_ENTRY_MS = 90_000
// A single noisy landmark frame must not erase almost 90 seconds of valid
// focus. Brief failures are withheld from Deep Focus time, then the gate resets
// only when the interruption itself is sustained.
export const FLOW_INTERRUPTION_HOLD_MS = 1_500

export function advanceFlowGate(current = {}, sample = {}) {
  const sampleMs = Number.isFinite(sample.sampleMs) && sample.sampleMs > 0 ? sample.sampleMs : 0
  const qualifiedMs = nonNegative(current.qualifiedMs)
  const interruptionMs = nonNegative(current.interruptionMs)
  const inFlow = current.inFlow === true

  if (sample.qualified === true) {
    const nextQualifiedMs = Math.min(FLOW_ENTRY_MS, qualifiedMs + sampleMs)
    return {
      qualifiedMs: nextQualifiedMs,
      interruptionMs: 0,
      inFlow: inFlow || nextQualifiedMs >= FLOW_ENTRY_MS,
    }
  }

  const nextInterruptionMs = interruptionMs + sampleMs
  if (nextInterruptionMs >= FLOW_INTERRUPTION_HOLD_MS) {
    return { qualifiedMs: 0, interruptionMs: FLOW_INTERRUPTION_HOLD_MS, inFlow: false }
  }
  return { qualifiedMs, interruptionMs: nextInterruptionMs, inFlow }
}

export function measuredSpanSeconds({
  previousAt,
  now,
  lastDeliveredFrameAt,
  maxSpanMs = MAX_MEASUREMENT_SPAN_MS,
}) {
  if (
    !Number.isFinite(previousAt) ||
    !Number.isFinite(now) ||
    !Number.isFinite(lastDeliveredFrameAt) ||
    !Number.isFinite(maxSpanMs) ||
    previousAt <= 0 ||
    lastDeliveredFrameAt <= 0 ||
    now <= previousAt ||
    maxSpanMs <= 0
  ) return 0

  const elapsedMs = now - previousAt
  const frameAgeMs = now - lastDeliveredFrameAt
  if (elapsedMs > maxSpanMs || frameAgeMs < 0 || frameAgeMs > maxSpanMs) return 0
  return elapsedMs / 1000
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

// One pure transition for both regular timer callbacks and the final flush.
// Keeping phase, streak, timeline and score accumulation together prevents the
// two paths from silently assigning the same seconds to different metrics.
export function accumulateMeasuredSpan(current = {}, sample = {}) {
  const sampleSeconds = sample.sampleSeconds
  const elapsedSecs = sample.elapsedSecs
  const roundedScore = Math.round(sample.score)
  if (
    !Number.isFinite(sampleSeconds) || sampleSeconds <= 0 ||
    !Number.isFinite(elapsedSecs) || elapsedSecs < 0 ||
    !Number.isFinite(roundedScore) || roundedScore < 0 || roundedScore > 100
  ) return null

  const focused = isFocusedSecond(roundedScore)
  const deepFocused = sample.inFlow === true && sample.flowQualified === true && roundedScore >= FLOW_SCORE
  const goodStreakSeconds = roundedScore >= GOOD_STREAK_SCORE
    ? nonNegative(current.goodStreakSeconds) + sampleSeconds
    : 0
  const currentStreak = focused
    ? nonNegative(current.currentStreak) + sampleSeconds
    : 0
  const longestStreak = Math.max(nonNegative(current.longestStreak), currentStreak)
  const nextPhase = classifyFocusPhase({
    elapsedSecs,
    score: roundedScore,
    goodStreakSecs: goodStreakSeconds,
    msSinceDistraction: sample.msSinceDistraction,
    preDriftActive: sample.preDriftActive === true,
    inFlow: sample.inFlow === true,
  })
  const previousPhase = current.currentPhase || 'arrival'
  const phaseSeconds = {
    ...(current.phaseSeconds || {}),
    [nextPhase]: nonNegative(current.phaseSeconds?.[nextPhase]) + sampleSeconds,
  }
  const timelineIntervalSeconds = Number.isFinite(sample.timelineIntervalSeconds) && sample.timelineIntervalSeconds > 0
    ? sample.timelineIntervalSeconds
    : 5
  const timelineBucket = Math.floor(elapsedSecs / timelineIntervalSeconds)
  const lastTimelineBucket = nonNegative(current.lastTimelineBucket)
  const shouldSnapshot = elapsedSecs > 0 &&
    (sample.forceTimelineSample === true || timelineBucket > lastTimelineBucket)

  return {
    score: roundedScore,
    focused,
    measuredSeconds: nonNegative(current.measuredSeconds) + sampleSeconds,
    scoreSum: nonNegative(current.scoreSum) + roundedScore * sampleSeconds,
    focusedSeconds: nonNegative(current.focusedSeconds) + (focused ? sampleSeconds : 0),
    flowSeconds: nonNegative(current.flowSeconds) + (deepFocused ? sampleSeconds : 0),
    preDriftSeconds: nonNegative(current.preDriftSeconds) + (sample.preDriftActive === true ? sampleSeconds : 0),
    currentStreak,
    longestStreak,
    goodStreakSeconds,
    currentPhase: nextPhase,
    phaseSeconds,
    phaseTransition: nextPhase !== previousPhase
      ? { second: elapsedSecs, from: previousPhase, to: nextPhase }
      : null,
    lastTimelineBucket: shouldSnapshot ? Math.max(lastTimelineBucket, timelineBucket) : lastTimelineBucket,
    timelineSample: shouldSnapshot ? {
      second: elapsedSecs,
      score: roundedScore,
      focused,
      inFlow: sample.inFlow === true,
      deepFocused,
      preDrift: sample.preDriftActive === true,
      phase: nextPhase,
      activity: sample.activity || null,
    } : null,
  }
}
