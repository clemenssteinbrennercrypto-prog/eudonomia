import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import SessionReport from './SessionReport'
import { analyzeSession } from '../lib/sessionAnalysis'

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
    deepFocusTimeVersion: 1,
    flowSeconds: 300,
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

function renderReport() {
  const session = fixtureSession()
  const analysis = analyzeSession(session, { priorSessions: [] })
  return renderToString(React.createElement(SessionReport, {
    session,
    analysis,
    onOutcomeChange() {},
    onPrimaryAction() {},
    onSecondaryAction() {},
    onRepeat() {},
  })).replaceAll('<!-- -->', '')
}

describe('SessionReport contract', () => {
  it('renders all four post-session sections for a ready session', () => {
    const html = renderReport()
    expect(html).toContain('Quick check-in')
    expect(html).toContain('Session read')
    expect(html).toContain('5m')
    expect(html).toContain('deep focus')
    expect(html).toContain('83/100')
    expect(html).toContain('Continue to Analytics')
  })
})
