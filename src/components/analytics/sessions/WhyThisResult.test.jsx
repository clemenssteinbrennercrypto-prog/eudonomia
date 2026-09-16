import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { analyzeSession } from '../../../lib/sessionAnalysis'
import WhyThisResult from './WhyThisResult'

function session(extra = {}) {
  const actualSeconds = 600
  return {
    id: 'trace',
    timestamp: 1_800_000_000_000,
    actualSeconds,
    measuredSeconds: actualSeconds,
    focusedSeconds: 480,
    scoreSum: 75 * actualSeconds,
    avgFocusScore: 75,
    scoreMeasured: true,
    attentionScoringVersion: 2,
    attentionMeasurementSource: 'native_mediapipe_v2',
    goalOutcome: 'no',
    goal: 'Ship the draft',
    ...extra,
  }
}

function render(record) {
  return renderToString(React.createElement(WhyThisResult, {
    session: record,
    analysis: analyzeSession(record),
  })).replaceAll('<!-- -->', '')
}

describe('Why this result', () => {
  it('shows the reconstructable arithmetic, band rule, outcome, and selected codes', () => {
    const html = render(session())
    expect(html).toContain('45000 accumulated score-seconds / 600 measured seconds = <b>75%</b>')
    expect(html).toContain('High attention (average ≥ 70)')
    expect(html).toContain('HIGH_FOCUS_GOAL_MISSED')
    expect(html).toContain('SPLIT_SCOPE_SMALLER')
  })

  it('names the missing component trace rather than inventing causes', () => {
    const html = render(session())
    expect(html).toContain('Trace unavailable for this record')
    expect(html).toContain('does not invent which individual bonuses or penalties')
  })

  it('shows stored score components and the exact latest transformation', () => {
    const html = render(session({
      scoreTraceVersion: 1,
      timeline: [{
        second: 5,
        score: 72,
        scoreTrace: {
          version: 1,
          components: { face_present_base: 68, phone_confirmed: -45 },
          cameraScore: 28,
          preRampScore: 28,
          rampBonus: 0,
          rawFinal: 28,
          previousScore: 90,
          finalScore: 71.4,
          signals: { pitchDeg: 31 },
        },
      }],
    }))
    expect(html).toContain('What changed the score')
    expect(html).toContain('Confirmed phone/downward distraction')
    expect(html).toContain('Camera 28.0 → after activity 28.0')
    expect(html).toContain('&quot;pitchDeg&quot;:31')
  })
})
