import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import AnalyticsStory from './AnalyticsStory'
import { emptyFocusLedger } from '../../lib/focusMetric'

function session(index, extra = {}) {
  const actualSeconds = 1800
  return {
    id: `s-${index}`,
    timestamp: 1_800_000_000_000 + index * 1000,
    actualSeconds,
    measuredSeconds: actualSeconds,
    focusedSeconds: 1200,
    scoreSum: 70 * actualSeconds,
    avgFocusScore: 70,
    scoreMeasured: true,
    deepFocusTimeVersion: 1,
    flowSeconds: 300,
    attentionScoringVersion: 2,
    task: `Task ${index}`,
    goalOutcome: 'yes',
    ...extra,
  }
}

function render(sessions) {
  return renderToString(React.createElement(AnalyticsStory, {
    sessions,
    focusLedger: emptyFocusLedger(),
    selectedSessionId: null,
    onSelectSession() {},
    onDeleteSession() {},
    onClearAll() {},
    onUpdateSession() {},
  })).replaceAll('<!-- -->', '')
}

describe('Analytics Story', () => {
  it('shows useful recent values before a full comparison is available', () => {
    const html = render([
      session(1, { goalOutcome: 'yes', avgFocusScore: 60, scoreSum: 60 * 1800 }),
      session(2, { goalOutcome: null, avgFocusScore: 80, scoreSum: 80 * 1800 }),
    ])
    expect(html).toContain('Your latest 2 sessions')
    expect(html).toContain('70/100')
    expect(html).toContain('1/1')
    expect(html).toContain('These values are useful now')
  })

  it('asks for missing outcomes before giving a derived recommendation', () => {
    const html = render([session(1, { goalOutcome: null })])
    expect(html.indexOf('Missing outcomes')).toBeLessThan(html.indexOf('Next session'))
    expect(html).toContain('How did these sessions go?')
  })

  it('uses the agreed 8-vs-8 comparison and does not restore Focus Score', () => {
    const html = render(Array.from({ length: 16 }, (_, index) => session(index)))
    expect(html).toContain('Your latest 8 sessions')
    expect(html).toContain('Compared with the previous 8 sessions')
    expect(html).toContain('Average attention')
    expect(html).toContain('70/100')
    expect(html).not.toContain('Average focus')
    expect(html).not.toContain('Focus Score')
  })

  it('keeps raw intervention counters out of the overview', () => {
    const html = render([session(1)])
    expect(html).not.toContain('Protection blocks')
    expect(html).not.toContain('What the app did')
  })
})
