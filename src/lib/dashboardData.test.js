import { describe, expect, it } from 'vitest'
import { ATTENTION_SCORING_VERSION, emptyFocusLedger } from './focusMetric'
import { buildAttentionField, buildDashboardData } from './dashboardData'

const NOW = new Date(2026, 7, 25, 12, 0, 0).getTime()

describe('dashboard data', () => {
  it('builds the attention field only from matching measured timelines', () => {
    const start = new Date(2026, 7, 25, 8, 0, 0).getTime()
    const bins = buildAttentionField([
      {
        startedAt: start,
        actualSeconds: 3 * 60 * 60,
        attentionScoringVersion: ATTENTION_SCORING_VERSION,
        timeline: [
          { second: 60, score: 82 },
          { second: 60 * 60, score: 55 },
          { second: 2 * 60 * 60, score: 22 },
        ],
      },
      {
        startedAt: start,
        actualSeconds: 60 * 60,
        attentionScoringVersion: ATTENTION_SCORING_VERSION + 1,
        timeline: [{ second: 60, score: 99 }],
      },
    ], { range: 'day', now: NOW, bins: 24 })

    const states = new Set(bins.map(bin => bin.state))
    expect(states).toContain('strong')
    expect(states).toContain('focused')
    expect(states).toContain('drift')
    expect(states).toContain('no-signal')
    expect(states).toContain('inactive')
    expect(states).toContain('future')
  })

  it('never calls idle protection active', () => {
    const base = {
      ledger: emptyFocusLedger(), sessions: [], scoreRange: 'day', fieldRange: 'day', now: NOW,
    }
    expect(buildDashboardData({ ...base, focusModeEnabled: false, focusConfig: {} }).protection.state).toBe('off')
    expect(buildDashboardData({ ...base, focusModeEnabled: true, focusConfig: {} }).protection.state).toBe('empty')
    const ready = buildDashboardData({
      ...base,
      focusModeEnabled: true,
      focusConfig: { distractionApps: ['Slack'], distractionDomains: ['youtube.com'] },
      nativeStatus: { checked: true, connected: true, helperInstalled: true },
    }).protection
    expect(ready).toEqual({ state: 'ready', label: 'Ready', detail: '1 app · 1 website' })
  })

  it('renders unmeasured recent sessions without fabricating focus', () => {
    const result = buildDashboardData({
      ledger: emptyFocusLedger(),
      sessions: [{ id: 'legacy', task: 'Old work', actualSeconds: 1200 }],
      focusConfig: {}, focusModeEnabled: true, now: NOW,
    })
    // Current ledger semantics reserve 0 for a day with no focus activity;
    // null means activity existed but could not be measured reliably.
    expect(result.period.score).toBe(0)
    expect(result.recentSessions[0].focus).toBeNull()
  })

  it('refuses a thin session focus value even when focusedSeconds exists', () => {
    const result = buildDashboardData({
      ledger: emptyFocusLedger(),
      sessions: [{
        id: 'thin', task: 'Quick check', actualSeconds: 90,
        focusedSeconds: 85, sessionEfficiency: null,
        focusMetricVersion: 1, focusMetricRejection: 'insufficient_duration',
      }],
      focusConfig: {}, focusModeEnabled: true, now: NOW,
    })
    expect(result.recentSessions[0].focus).toBeNull()
  })

  it('does not report configured protection ready before native verification', () => {
    const base = {
      ledger: emptyFocusLedger(), sessions: [], focusModeEnabled: true, now: NOW,
      focusConfig: { distractionApps: ['Slack'], distractionDomains: ['youtube.com'] },
    }
    expect(buildDashboardData(base).protection.state).toBe('checking')
    expect(buildDashboardData({ ...base, nativeStatus: { checked: true, connected: false } }).protection.state).toBe('disconnected')
    expect(buildDashboardData({ ...base, nativeStatus: { checked: true, connected: true, helperInstalled: false } }).protection.state).toBe('helper')
  })
})
