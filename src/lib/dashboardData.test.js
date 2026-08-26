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
    expect(bins[0].timestamp).toBe(new Date(2026, 7, 25, 0, 0, 0).getTime())
    expect(bins[1].timestamp - bins[0].timestamp).toBe(60 * 60 * 1000)
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
      sessions: [{ id: 'legacy', task: 'Old work', timestamp: NOW, actualSeconds: 1200 }],
      focusConfig: {}, focusModeEnabled: true, now: NOW,
    })
    // The session proves there was activity, but no ledger measurement exists.
    // Passing sessions through keeps Lab aligned with History: absent, not 0.
    expect(result.period.score).toBeNull()
    expect(result.period.days[0].noActivity).toBeUndefined()
    expect(result.recentSessions[0].efficiency).toBeNull()
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
    expect(result.recentSessions[0].efficiency).toBeNull()
  })

  it('refuses an out-of-range efficiency instead of displaying it as measured', () => {
    const result = buildDashboardData({
      ledger: emptyFocusLedger(),
      sessions: [{
        id: 'invalid', task: 'Broken record', actualSeconds: 1200,
        sessionEfficiency: 101, focusMetricVersion: 1, focusMetricRejection: null,
      }],
      focusConfig: {}, focusModeEnabled: true, now: NOW,
    })
    expect(result.recentSessions[0].efficiency).toBeNull()
  })

  it('labels the recent-session metric as efficiency, not generic focus', () => {
    const result = buildDashboardData({
      ledger: emptyFocusLedger(),
      sessions: [{
        id: 'valid', task: 'Measured work', actualSeconds: 1200,
        sessionEfficiency: 78, focusMetricVersion: 1, focusMetricRejection: null,
      }],
      focusConfig: {}, focusModeEnabled: true, now: NOW,
    })
    expect(result.recentSessions[0]).toMatchObject({ efficiency: 78 })
    expect(result.recentSessions[0]).not.toHaveProperty('focus')
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
