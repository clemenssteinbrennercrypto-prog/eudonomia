import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import Sessions from './Sessions'
import { emptyFocusLedger } from '../../lib/focusMetric'

function session({ id, daysAgo = 1, pct = 70, extra = {} } = {}) {
  const actualSeconds = 1800
  return {
    id,
    timestamp: Date.now() - daysAgo * 24 * 60 * 60 * 1000,
    actualSeconds,
    measuredSeconds: actualSeconds,
    focusedSeconds: Math.round(actualSeconds * (pct / 100)),
    avgFocusScore: pct,
    scoreMeasured: true,
    ...extra,
  }
}

function render(sessions, props = {}) {
  return renderToString(React.createElement(Sessions, {
    sessions,
    focusLedger: emptyFocusLedger(),
    selectedSessionId: null,
    onSelectSession() {},
    onDeleteSession() {},
    onClearAll() {},
    onUpdateSession() {},
    ...props,
  })).replaceAll('<!-- -->', '')
}

describe('Sessions — filters', () => {
  it('lists every session with no filters applied', () => {
    const html = render([session({ id: 'a', extra: { task: 'Write docs' } }), session({ id: 'b', extra: { task: 'Review PR' } })])
    expect(html).toContain('Write docs')
    expect(html).toContain('Review PR')
  })

  it('shows an empty state entirely when there are no sessions', () => {
    const html = render([])
    expect(html).toContain('No sessions yet')
  })
})

describe('Sessions — pagination', () => {
  it('shows a page indicator once there are more than 10 sessions', () => {
    const sessions = Array.from({ length: 15 }, (_, i) => session({ id: `s${i}`, extra: { task: `Task ${i}` } }))
    const html = render(sessions)
    expect(html).toContain('1–10 of 15')
  })

  it('does not show pagination controls for 10 or fewer sessions', () => {
    const sessions = Array.from({ length: 5 }, (_, i) => session({ id: `s${i}` }))
    const html = render(sessions)
    expect(html).not.toContain('Previous')
  })
})

describe('Sessions — legacy records missing newer fields', () => {
  it('renders a session with no workspace, no tags, and no outcome without crashing', () => {
    const legacy = { id: 'legacy', timestamp: Date.now(), actualSeconds: 600, focusedSeconds: 400, task: 'Old session' }
    expect(() => render([legacy])).not.toThrow()
    const html = render([legacy])
    expect(html).toContain('Old session')
  })
})

describe('Sessions — detail view', () => {
  it('opens the shared session report when a session is selected', () => {
    const s = session({ id: 'a', extra: { task: 'Write docs', goalOutcome: 'yes' } })
    const html = render([s], { selectedSessionId: 'a' })
    expect(html).toContain('Quick check-in')
  })
})
