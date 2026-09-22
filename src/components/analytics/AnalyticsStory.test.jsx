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
  it('puts unrated outcomes ahead of every derived recommendation', () => {
    const html = render([session(1, { goalOutcome: null })])
    expect(html.indexOf('Outcome inbox')).toBeLessThan(html.indexOf('Next experiment'))
    expect(html).toContain('Close the evidence gap')
  })

  it('uses the agreed 8-vs-8 comparison and does not restore Focus Score', () => {
    const html = render(Array.from({ length: 16 }, (_, index) => session(index)))
    expect(html).toContain('Latest 8 vs previous 8')
    expect(html).toContain('Deep focus')
    expect(html).not.toContain('Average focus')
    expect(html).not.toContain('Focus Score')
  })

  it('states the intervention boundary instead of fabricating protection events', () => {
    const html = render([session(1)])
    expect(html).toContain('Protection blocks')
    expect(html).toContain('not tracked yet')
  })
})
