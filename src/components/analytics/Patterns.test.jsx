import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import Patterns from './Patterns'
import { MIN_SESSIONS } from '../../lib/calibration'

function session({ hour = 10, mins = 40, pct = 70, extra = {} } = {}) {
  const end = new Date()
  end.setHours(hour, 0, 0, 0)
  const actualSeconds = mins * 60
  return {
    id: `s-${Math.random()}`,
    timestamp: end.getTime() + actualSeconds * 1000,
    actualSeconds,
    measuredSeconds: actualSeconds,
    focusedSeconds: Math.round(actualSeconds * (pct / 100)),
    avgFocusScore: pct,
    scoreMeasured: true,
    ...extra,
  }
}

const many = (n, opts) => Array.from({ length: n }, () => session(opts))

function render(sessions) {
  return renderToString(React.createElement(Patterns, { sessions })).replaceAll('<!-- -->', '')
}

describe('Patterns — refusal below the qualification floor', () => {
  it('names how many more sessions are needed instead of a claim', () => {
    const html = render(many(3))
    expect(html).toContain(`of ${MIN_SESSIONS} needed`)
    expect(html).not.toContain('Goal outcomes')
  })
})

describe('Patterns — sample sizes and honest qualification per axis', () => {
  it('shows an honest "not enough sessions" state for an axis with no data', () => {
    // No workspace field on any session -> workspace axis has zero buckets.
    const html = render(many(MIN_SESSIONS))
    expect(html).toContain('Workspace')
    expect(html).toContain('Not enough sessions with this data yet.')
  })

  it('always shows the static honest state for blocking, which is not tracked yet', () => {
    const html = render(many(MIN_SESSIONS))
    expect(html).toContain('Blocking')
    expect(html).toContain('Not tracked per session yet')
  })

  it('names a real time-of-day pattern with its sample size', () => {
    const morning = many(5, { hour: 9, pct: 88 })
    const afternoon = many(5, { hour: 15, pct: 40 })
    const html = render([...morning, ...afternoon])
    expect(html).toContain('88%')
    expect(html).toContain('40%')
  })

  it('shows the overall goal-outcome hit rate at the top, prioritized ahead of conditions', () => {
    const rated = many(8, { extra: { goalOutcome: 'yes' } })
    const html = render(rated)
    const outcomeIndex = html.indexOf('Goal outcomes')
    const conditionIndex = html.indexOf('Time of day')
    expect(outcomeIndex).toBeGreaterThan(-1)
    expect(conditionIndex).toBeGreaterThan(-1)
    expect(outcomeIndex).toBeLessThan(conditionIndex)
    expect(html).toContain('100%')
  })

  it('crosses a qualified condition against goal outcomes, not just focus percentage', () => {
    const morningYes = many(5, { hour: 9, pct: 88, extra: { goalOutcome: 'yes' } })
    const afternoonNo = many(5, { hour: 15, pct: 40, extra: { goalOutcome: 'no' } })
    const html = render([...morningYes, ...afternoonNo])
    expect(html).toContain('Goal reached in')
  })
})
