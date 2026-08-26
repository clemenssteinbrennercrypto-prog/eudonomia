// A WebView timer is only a wake-up signal, never a clock. macOS may throttle
// background callbacks while the user works in another app, so one callback
// can represent more than one real second. Count the elapsed wall time only
// while a recent camera frame proves that the signal is still alive.

import { GOOD_STREAK_SCORE, classifyFocusPhase, isFocusedSecond } from './attention'

export const ATTENTION_ACCUMULATION_VERSION = 2
export const MAX_MEASUREMENT_SPAN_MS = 3_000

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
      preDrift: sample.preDriftActive === true,
      phase: nextPhase,
      activity: sample.activity || null,
    } : null,
  }
}
