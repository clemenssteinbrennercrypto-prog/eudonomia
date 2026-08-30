import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import LabDashboard from './LabDashboard'
import { ATTENTION_SCORING_VERSION, FOCUS_METRIC_V1 } from '../lib/focusMetric'
import { loadFocusLedger, saveSession } from '../lib/storage'

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 7, 26, 14, 0, 0))
})

afterEach(() => vi.useRealTimers())

describe('LabDashboard metric labels', () => {
  it('keeps measured time and efficiency semantically distinct', () => {
    // saveSession still runs so the focus ledger is built by the real code
    // path; sessions and ledger are then handed to the component as props,
    // which is how App supplies them at runtime.
    const saved = saveSession({
      task: 'Measured work',
      startedAt: Date.now() - 620_000,
      actualSeconds: 620,
      measuredSeconds: 600,
      scoreSum: 46_800,
      focusedSeconds: 480,
      attentionScoringVersion: ATTENTION_SCORING_VERSION,
      focusMetricVersion: FOCUS_METRIC_V1.version,
      focusMetricRejection: null,
      sessionEfficiency: 78,
      deepFocusSeconds: 600,
      deepFocusMinutes: 10,
    })

    const html = renderToString(React.createElement(LabDashboard, {
      focusModeEnabled: false,
      sessions: [saved],
      ledger: loadFocusLedger(),
      onSession() {},
      onProtection() {},
      onAnalytics() {},
    })).replaceAll('<!-- -->', '')

    expect(html).toContain('Measured time')
    expect(html).toContain('78% efficiency')
    expect(html).not.toContain('Measured focus')
    expect(html).not.toContain('78 focus')
  })
})
