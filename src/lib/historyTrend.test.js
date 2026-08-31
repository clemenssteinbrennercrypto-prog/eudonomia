import { describe, expect, it } from 'vitest'
import {
  aggregateFocusMeasurements,
  buildHistoryTrend,
  hasMeasuredFocus,
  measuredSessionDayStreak,
  outcomeDistribution,
  sessionFocusPct,
} from './historyTrend'

const NOW = new Date(2026, 7, 10, 12, 0, 0)

function sessionAt(date, focusPct = 70, extra = {}) {
  const actualSeconds = 60 * 60
  return {
    timestamp: date.getTime(),
    actualSeconds,
    focusedSeconds: Math.round(actualSeconds * focusPct / 100),
    avgFocusScore: focusPct,
    ...extra,
  }
}

describe('session focus measurement', () => {
  it('keeps unmeasured sessions out of focus averages', () => {
    const faulted = sessionAt(NOW, 70, {
      trackingFaulted: true,
      avgFocusScore: null,
      finalScore: null,
    })
    expect(hasMeasuredFocus(faulted)).toBe(false)
    expect(sessionFocusPct(faulted)).toBeNull()
  })

  it('does not turn an unmeasured camera gap into distracted time', () => {
    const partial = sessionAt(NOW, 50, {
      actualSeconds: 3600,
      measuredSeconds: 1800,
      focusedSeconds: 900,
    })
    expect(sessionFocusPct(partial)).toBe(50)
  })

  it('refuses zero, negative, overflowing, and non-finite measurements', () => {
    for (const invalid of [
      sessionAt(NOW, 0, { measuredSeconds: 0, focusedSeconds: 0 }),
      sessionAt(NOW, 0, { measuredSeconds: 100, focusedSeconds: -1 }),
      sessionAt(NOW, 0, { measuredSeconds: 100, focusedSeconds: 101 }),
      sessionAt(NOW, 0, { actualSeconds: 100, measuredSeconds: 102, focusedSeconds: 50 }),
      sessionAt(NOW, 0, { measuredSeconds: 100, focusedSeconds: NaN }),
      sessionAt(NOW, 50, { measuredSeconds: 100, focusedSeconds: 50, avgFocusScore: null }),
    ]) {
      expect(hasMeasuredFocus(invalid)).toBe(false)
      expect(sessionFocusPct(invalid)).toBeNull()
    }
  })

  it('weights aggregate focus by measured time rather than session count', () => {
    const fiveMinutesPerfect = sessionAt(NOW, 100, {
      actualSeconds: 300, measuredSeconds: 300, focusedSeconds: 300,
    })
    const ninetyFiveMinutesDrift = sessionAt(NOW, 0, {
      actualSeconds: 5700, measuredSeconds: 5700, focusedSeconds: 0,
    })
    expect(aggregateFocusMeasurements([fiveMinutesPerfect, ninetyFiveMinutesDrift])).toEqual({
      focusedSeconds: 300,
      measuredSeconds: 6000,
      sessionCount: 2,
      focusPct: 5,
    })
  })

  // Superseded on 31 August: the native ruler becomes the primary one, so
  // comparisons follow the newest generation present rather than being pinned
  // to V1 forever. The invariant that matters is unchanged — two generations
  // are never averaged together — but the survivor is now the newer one, and
  // V1 history is set aside rather than V2.
  it('compares within one generation, following the ruler most recently used', () => {
    const earlier = new Date(2026, 7, 10, 9, 0, 0)
    const later = new Date(2026, 7, 10, 11, 0, 0)
    const webviewV1 = sessionAt(earlier, 80, { attentionScoringVersion: 1 })
    const nativeV2 = sessionAt(later, 10, { attentionScoringVersion: 2 })
    expect(sessionFocusPct(nativeV2)).toBe(10)
    // A blend would land between 10 and 80; this must be V2's number alone.
    expect(aggregateFocusMeasurements([webviewV1, nativeV2])).toMatchObject({
      sessionCount: 1,
      focusPct: 10,
    })
    expect(buildHistoryTrend([webviewV1, nativeV2], { range: 'week', now: NOW }).buckets[0])
      .toMatchObject({ count: 1, avgFocus: 10 })
  })

  // The toggle promises that switching V2 off restores the V1 source. Picking
  // the highest version number present broke that promise: one old V2 session
  // pinned every comparison to V2 forever and silently dropped the V1 sessions
  // recorded afterwards. Recency is what makes switching back actually work.
  it('returns to V1 once V1 is the ruler in recent use again', () => {
    const strayV2 = sessionAt(new Date(2026, 7, 3, 9), 10, { attentionScoringVersion: 2 })
    const laterV1 = [
      sessionAt(new Date(2026, 7, 8, 9), 80, { attentionScoringVersion: 1 }),
      sessionAt(new Date(2026, 7, 9, 9), 80, { attentionScoringVersion: 1 }),
      sessionAt(new Date(2026, 7, 10, 9), 80, { attentionScoringVersion: 1 }),
    ]
    expect(aggregateFocusMeasurements([strayV2, ...laterV1])).toMatchObject({
      sessionCount: 3,
      focusPct: 80,
    })
  })

  it('is unaffected by the order the sessions happen to arrive in', () => {
    const older = sessionAt(new Date(2026, 7, 8, 9), 80, { attentionScoringVersion: 1 })
    const newer = sessionAt(new Date(2026, 7, 10, 9), 10, { attentionScoringVersion: 2 })
    // Newest-first and oldest-first must agree — callers pass both orderings.
    expect(aggregateFocusMeasurements([newer, older]).focusPct).toBe(10)
    expect(aggregateFocusMeasurements([older, newer]).focusPct).toBe(10)
  })

  it('leaves a single-generation history exactly as it was', () => {
    const a = sessionAt(NOW, 80, { attentionScoringVersion: 1 })
    const b = sessionAt(NOW, 60, { attentionScoringVersion: 1 })
    expect(aggregateFocusMeasurements([a, b]).sessionCount).toBe(2)
    // Pre-versioning records count as the same generation as explicit V1.
    const legacy = sessionAt(NOW, 70)
    expect(aggregateFocusMeasurements([a, legacy]).sessionCount).toBe(2)
  })

  it('keeps yesterday\'s measured streak alive while today is still pending', () => {
    const monday = new Date(2026, 7, 17, 12)
    const tuesday = new Date(2026, 7, 18, 12)
    const wednesday = new Date(2026, 7, 19, 9)
    expect(measuredSessionDayStreak([
      sessionAt(monday),
      sessionAt(tuesday),
      sessionAt(wednesday, 0, { measuredSeconds: 0, focusedSeconds: 0 }),
    ], wednesday)).toBe(2)
  })

  it('refuses malformed aggregate and streak inputs without throwing', () => {
    expect(aggregateFocusMeasurements('not sessions')).toMatchObject({ sessionCount: 0, focusPct: null })
    expect(measuredSessionDayStreak({}, 'not a date')).toBe(0)
  })
})

describe('history trend ranges', () => {
  it('builds the current Monday-to-Sunday week', () => {
    const trend = buildHistoryTrend([sessionAt(NOW, 82)], { range: 'week', now: NOW })
    expect(trend.buckets).toHaveLength(7)
    expect(trend.title).toBe('Aug 10–16, 2026')
    expect(trend.buckets[0]).toMatchObject({ label: 'Mon', dateLabel: 'Aug 10', avgFocus: 82, count: 1 })
    expect(trend.buckets[6].dateLabel).toBe('Aug 16')
    expect(trend.canGoForward).toBe(false)
  })

  it('can move back through earlier calendar weeks', () => {
    const previousMonday = new Date(2026, 7, 3, 9, 0, 0)
    const trend = buildHistoryTrend([sessionAt(previousMonday, 64)], {
      range: 'week',
      weekOffset: -1,
      now: NOW,
    })
    expect(trend.buckets[0]).toMatchObject({ dateLabel: 'Aug 3', avgFocus: 64 })
    expect(trend.buckets[6].dateLabel).toBe('Aug 9')
    expect(trend.canGoForward).toBe(true)
  })

  it('shows exactly 30 daily buckets including today', () => {
    const trend = buildHistoryTrend([], { range: '30days', now: NOW })
    expect(trend.buckets).toHaveLength(30)
    expect(trend.buckets[0].dateLabel).toBe('Jul 12')
    expect(trend.buckets[29].dateLabel).toBe('Aug 10')
  })

  it('groups the last year into 12 calendar months', () => {
    const trend = buildHistoryTrend([], { range: 'year', now: NOW })
    expect(trend.buckets).toHaveLength(12)
    expect(trend.buckets[0]).toMatchObject({ label: 'Sep', dateLabel: 'Sep 2025' })
    expect(trend.buckets[11]).toMatchObject({ label: 'Aug', dateLabel: 'Aug 2026' })
  })

  it('starts the all-time view at the first session month', () => {
    const first = new Date(2026, 2, 5, 12, 0, 0)
    const trend = buildHistoryTrend([sessionAt(first, 75)], { range: 'all', now: NOW })
    expect(trend.buckets).toHaveLength(6)
    expect(trend.buckets[0]).toMatchObject({ dateLabel: 'Mar 2026', avgFocus: 75 })
    expect(trend.buckets[5].dateLabel).toBe('Aug 2026')
  })

  it('counts faulted sessions but does not turn them into a zero score', () => {
    const faulted = sessionAt(NOW, 70, {
      trackingFaulted: true,
      avgFocusScore: null,
      finalScore: null,
    })
    const trend = buildHistoryTrend([sessionAt(NOW, 80), faulted], { range: 'week', now: NOW })
    expect(trend.buckets[0]).toMatchObject({ count: 2, avgFocus: 80 })
  })

  it('uses the same time-weighted percentage within a trend bucket', () => {
    const short = sessionAt(NOW, 100, { actualSeconds: 300, measuredSeconds: 300, focusedSeconds: 300 })
    const long = sessionAt(NOW, 0, { actualSeconds: 5700, measuredSeconds: 5700, focusedSeconds: 0 })
    expect(buildHistoryTrend([short, long], { range: 'week', now: NOW }).buckets[0]).toMatchObject({
      avgFocus: 5,
      count: 2,
    })
  })
})

describe('outcomeDistribution', () => {
  it('counts each outcome and buckets everything else as unrated', () => {
    const sessions = [
      sessionAt(NOW, 70, { goalOutcome: 'yes' }),
      sessionAt(NOW, 70, { goalOutcome: 'yes' }),
      sessionAt(NOW, 70, { goalOutcome: 'partly' }),
      sessionAt(NOW, 70, { goalOutcome: 'no' }),
      sessionAt(NOW, 70, {}),
    ]
    expect(outcomeDistribution(sessions)).toEqual({ yes: 2, partly: 1, no: 1, unrated: 1 })
  })

  it('normalizes a legacy goalAchieved boolean', () => {
    const sessions = [
      sessionAt(NOW, 70, { goalAchieved: true }),
      sessionAt(NOW, 70, { goalAchieved: false }),
    ]
    expect(outcomeDistribution(sessions)).toEqual({ yes: 1, partly: 0, no: 1, unrated: 0 })
  })

  it('handles an empty or missing session list', () => {
    expect(outcomeDistribution([])).toEqual({ yes: 0, partly: 0, no: 0, unrated: 0 })
    expect(outcomeDistribution(undefined)).toEqual({ yes: 0, partly: 0, no: 0, unrated: 0 })
  })
})
