import React from 'react'
import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import CheckIn from './CheckIn'
import { analyzeSession } from '../../lib/sessionAnalysis'

function render(session, extra = {}) {
  const analysis = analyzeSession(session, { priorSessions: [] })
  return renderToString(React.createElement(CheckIn, {
    session,
    analysis,
    onOutcomeChange() {},
    ...extra,
  })).replaceAll('<!-- -->', '')
}

describe('CheckIn', () => {
  it('shows the outcome buttons but no note field until an outcome exists', () => {
    const html = render({ id: 's1', actualSeconds: 600 })
    expect(html).toContain('Yes')
    expect(html).toContain('Partly')
    expect(html).toContain('No')
    expect(html).not.toContain('What did you complete?')
    expect(html).not.toContain('What got in the way?')
  })

  it('asks what you completed when the outcome is yes', () => {
    const html = render({ id: 's1', actualSeconds: 600, goalOutcome: 'yes' })
    expect(html).toContain('What did you complete?')
    expect(html).not.toContain('What got in the way?')
  })

  it('asks what got in the way for a partial outcome', () => {
    const html = render({ id: 's1', actualSeconds: 600, goalOutcome: 'partly' })
    expect(html).toContain('What got in the way?')
    expect(html).not.toContain('What did you complete?')
  })

  it('asks what got in the way for a missed outcome', () => {
    const html = render({ id: 's1', actualSeconds: 600, goalOutcome: 'no' })
    expect(html).toContain('What got in the way?')
    expect(html).not.toContain('What did you complete?')
  })

  it('marks the check-in as required', () => {
    const html = render({ id: 's1', actualSeconds: 600 })
    expect(html).toContain('required')
  })
})
