import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import Overview from './Overview'
import { emptyFocusLedger } from '../../lib/focusMetric'

const NOW = new Date(2026, 7, 15, 12, 0, 0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

function session({ daysAgo = 1, pct = 70, extra = {} } = {}) {
  const actualSeconds = 1800
  const timestamp = NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000
  return {
    id: `s-${timestamp}-${Math.random()}`,
    timestamp,
    actualSeconds,
    measuredSeconds: actualSeconds,
    focusedSeconds: Math.round(actualSeconds * (pct / 100)),
    avgFocusScore: pct,
    scoreMeasured: true,
    ...extra,
  }
}

function render(sessions) {
  return renderToString(React.createElement(Overview, {
    sessions,
    focusLedger: emptyFocusLedger(),
  })).replaceAll('<!-- -->', '')
}

describe('Overview — 30-day default range', () => {
  it('counts a session from within the last 30 days', () => {
    // 1800s actual, 70% focused -> 1260 focused seconds -> "21m".
    const html = render([session({ daysAgo: 5, pct: 70 })])
    expect(html).toContain('Last 30 days')
    expect(html).toContain('21m')
  })

  it('excludes a session older than 30 days from the range stats', () => {
    const recent = session({ daysAgo: 5, pct: 70, extra: { id: 'recent' } })
    const old = session({ daysAgo: 45, pct: 70, extra: { id: 'old' } })
    const html = render([recent, old])
    // If the 45-day-old session were included, measured focused time would
    // double to 42m. Only the recent session should count toward this range.
    expect(html).toContain('21m')
    expect(html).not.toContain('42m')
  })
})

describe('Overview — refusal state', () => {
  it('reports how many more sessions are needed when calibration is not ready', () => {
    const html = render([session({ daysAgo: 1 })])
    expect(html).toContain('more measured session')
  })

  it('shows the strongest pattern once enough sessions qualify', () => {
    const morning = Array.from({ length: 5 }, () => session({ daysAgo: 2, pct: 85, extra: { timestamp: new Date(2026, 7, 13, 10).getTime() } }))
    const afternoon = Array.from({ length: 5 }, () => session({ daysAgo: 2, pct: 45, extra: { timestamp: new Date(2026, 7, 13, 16).getTime() } }))
    const html = render([...morning, ...afternoon])
    expect(html).toContain('Strongest pattern')
    expect(html).toContain('85%')
  })
})

describe('Overview — distinct metric naming', () => {
  // Two different numbers live on this screen: a session's mean attention
  // score, and the versioned daily Focus Score, which folds in volume and
  // consistency. They must never be labelled as though they were the same
  // measure.
  it('never conflates average focus with the versioned Focus Score', () => {
    const html = render([session({ daysAgo: 1 })])
    expect(html).toContain('Average focus')
    expect(html).toContain('Focus Score')
  })
})
