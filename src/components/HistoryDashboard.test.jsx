import React from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import HistoryDashboard from './HistoryDashboard'
import { saveSession } from '../lib/storage'
import { ATTENTION_SCORING_VERSION, FOCUS_METRIC_V1 } from '../lib/focusMetric'

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
})

describe('HistoryDashboard focus score runtime', () => {
  it('renders the explicit no-backfill state for legacy history', () => {
    localStorage.setItem('eudaimonia_sessions', JSON.stringify([{
      id: 'legacy',
      timestamp: new Date(2026, 7, 4, 10).getTime(),
      actualSeconds: 1800,
      focusedSeconds: 1200,
      task: 'Legacy session',
    }]))
    const html = renderToString(React.createElement(HistoryDashboard, { onClose() {} })).replaceAll('<!-- -->', '')
    expect(html).toContain('Focus Score · v1')
    expect(html).toContain('Older sessions are not estimated')
  })

  it('renders a persisted v1 daily score and its drivers', () => {
    const startedAt = Date.now() - 122 * 60 * 1000
    saveSession({
      task: 'Measured session',
      startedAt,
      endedAt: Date.now(),
      timestamp: Date.now(),
      attentionScoringVersion: ATTENTION_SCORING_VERSION,
      focusMetricVersion: FOCUS_METRIC_V1.version,
      actualSeconds: 7220,
      measuredSeconds: 7200,
      scoreSum: 684_000,
      sessionEfficiency: 95,
      deepFocusMinutes: 120,
      focusedSeconds: 7000,
      finalScore: 94,
      scoreMeasured: true,
      focusPhases: { seconds: { arrival: 0, ramp: 0, lock_in: 7200, fade: 0, recovery: 0, drift: 0 } },
    })
    const html = renderToString(React.createElement(HistoryDashboard, { onClose() {} })).replaceAll('<!-- -->', '')
    expect(html).toContain('Daily focus score')
    expect(html).toContain('Full-day qualification')
    expect(html).toContain('120 / 120 measured min')
    expect(html).toContain('Deep focus')
  })
})
