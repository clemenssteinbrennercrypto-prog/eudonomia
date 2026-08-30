import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import SessionReport from './SessionReport'
import { analyzeSession } from '../lib/sessionAnalysis'

// The spec requires that the post-session screen and the reopened-from-history
// detail view render "the same analysis contract". Since MeasuredFacts,
// CheckIn, SessionRead, and SessionDetails take no `mode` prop at all, this is
// true by construction — this test exists to catch a future regression where
// someone starts branching one of those four sections on `mode` without
// noticing they've broken that guarantee.
function fixtureSession() {
  const actualSeconds = 1800
  return {
    id: 'sess-1',
    timestamp: new Date(2026, 7, 15, 14, 0, 0).getTime(),
    actualSeconds,
    measuredSeconds: actualSeconds,
    focusedSeconds: 1500,
    avgFocusScore: 83,
    scoreMeasured: true,
    attentionScoringVersion: 1,
    attentionAccumulationVersion: 2,
    plannedDuration: 30,
    task: 'Thesis',
    goal: 'Draft the intro chapter',
    energyLevel: 'medium',
    goalOutcome: 'yes',
    timeline: [],
    distractionLog: [],
    focusPhases: { seconds: {}, dominant: null },
    activityAlignment: null,
    outputEvidence: null,
    workspace: null,
    preDriftEvents: 0,
    preDriftSeconds: 0,
    distractionEvents: 0,
  }
}

function renderReport(mode) {
  const session = fixtureSession()
  const analysis = analyzeSession(session, { priorSessions: [] })
  const props = {
    session,
    analysis,
    mode,
    onOutcomeChange() {},
    onPrimaryAction() {},
  }
  if (mode === 'post-session') {
    props.onSecondaryAction = () => {}
    props.onRepeat = () => {}
  }
  return renderToString(React.createElement(SessionReport, props)).replaceAll('<!-- -->', '')
}

describe('SessionReport contract', () => {
  it('renders the same four sections in post-session and history mode', () => {
    const postSession = renderReport('post-session')
    const history = renderReport('history')

    // The action row is the only place the two modes are allowed to differ —
    // find where it starts in each and compare everything before it.
    const postSessionBody = postSession.slice(0, postSession.indexOf('Continue to Analytics'))
    const historyBody = history.slice(0, history.indexOf('Close<'))

    expect(postSessionBody.length).toBeGreaterThan(0)
    expect(historyBody.length).toBeGreaterThan(0)
    expect(postSessionBody).toBe(historyBody)
  })

  it('both modes render all four section headings for a ready session', () => {
    for (const mode of ['post-session', 'history']) {
      const html = renderReport(mode)
      expect(html).toContain('Quick check-in')
      expect(html).toContain('Session read')
      // time above threshold stat is part of Measured facts
      expect(html).toContain('83%')
    }
  })
})
