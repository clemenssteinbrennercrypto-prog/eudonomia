import { describe, expect, it } from 'vitest'
import { buildHistoryTrend, hasMeasuredFocus, sessionFocusPct } from './historyTrend'

const NOW = new Date(2026, 7, 10, 12, 0, 0)

function sessionAt(date, focusPct = 70, extra = {}) {
  const actualSeconds = 60 * 60
  return {
    timestamp: date.getTime(),
    actualSeconds,
    focusedSeconds: Math.round(actualSeconds * focusPct / 100),
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
})
