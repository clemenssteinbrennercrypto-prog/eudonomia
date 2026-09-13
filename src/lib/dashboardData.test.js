import { describe, expect, it } from 'vitest'
import { ATTENTION_SCORING_VERSION, emptyFocusLedger } from './focusMetric'
import { NATIVE_CAMERA_MEASUREMENT_V2 } from './cameraMeasurement'
import { buildAttentionField, buildDashboardData } from './dashboardData'

const NOW = new Date(2026, 7, 25, 12, 0, 0).getTime()

describe('dashboard data', () => {
  it('builds the attention field from the ruler in current use without mixing generations', () => {
    const start = new Date(2026, 7, 25, 8, 0, 0).getTime()
    const bins = buildAttentionField([
      {
        startedAt: start,
        timestamp: start + 3 * 60 * 60 * 1000,
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
        timestamp: start - 1,
        actualSeconds: 60 * 60,
        attentionScoringVersion: NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion,
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

  it('connects native V2 timeline samples to the attention field', () => {
    const start = new Date(2026, 7, 25, 8, 0, 0).getTime()
    const bins = buildAttentionField([{
      startedAt: start,
      timestamp: start + 3 * 60 * 60 * 1000,
      actualSeconds: 3 * 60 * 60,
      attentionScoringVersion: NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion,
      attentionMeasurementSource: NATIVE_CAMERA_MEASUREMENT_V2.id,
      timeline: [
        { second: 60, score: 82 },
        { second: 60 * 60, score: 55 },
        { second: 2 * 60 * 60, score: 22 },
      ],
    }], { range: 'day', now: NOW, bins: 24 })

    expect(bins[8]).toMatchObject({ state: 'strong', score: 82 })
    expect(bins[9]).toMatchObject({ state: 'focused', score: 55 })
    expect(bins[10]).toMatchObject({ state: 'drift', score: 22 })
  })

  it('keeps resumed work at its wall-clock time and marks the pause separately', () => {
    const startedAt = new Date(2026, 7, 25, 14, 0, 0).getTime()
    const endedAt = new Date(2026, 7, 25, 18, 0, 0).getTime()
    const bins = buildAttentionField([{
      startedAt,
      endedAt,
      timestamp: endedAt,
      actualSeconds: 3600,
      pausedSeconds: 3 * 3600,
      pauseIntervals: [{
        startedAt: new Date(2026, 7, 25, 14, 30, 0).getTime(),
        endedAt: new Date(2026, 7, 25, 17, 30, 0).getTime(),
      }],
      attentionScoringVersion: NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion,
      timeline: [
        { second: 15 * 60, wallSecond: 15 * 60, score: 82 },
        { second: 40 * 60, wallSecond: 3 * 60 * 60 + 40 * 60, score: 55 },
      ],
    }], { range: 'day', now: new Date(2026, 7, 25, 20, 0, 0).getTime(), bins: 24 })

    expect(bins[14]).toMatchObject({ state: 'strong', score: 82 })
    expect(bins[15]).toMatchObject({ state: 'paused', score: null })
    expect(bins[16]).toMatchObject({ state: 'paused', score: null })
    expect(bins[17]).toMatchObject({ state: 'focused', score: 55 })
  })

  it('refuses unknown or unversioned timelines instead of guessing their ruler', () => {
    const start = new Date(2026, 7, 25, 8, 0, 0).getTime()
    const bins = buildAttentionField([
      { startedAt: start, timestamp: start + 1000, actualSeconds: 600, timeline: [{ second: 60, score: 99 }] },
      { startedAt: start, timestamp: start + 2000, actualSeconds: 600, attentionScoringVersion: 99, timeline: [{ second: 60, score: 99 }] },
    ], { range: 'day', now: NOW, bins: 24 })

    expect(bins[8]).toMatchObject({ state: 'inactive', score: null })
  })

  it.each([
    ['day', -1, new Date(2026, 7, 24, 0, 0, 0).getTime(), 'Monday, Aug 24, 2026'],
    ['week', -1, new Date(2026, 7, 17, 0, 0, 0).getTime(), 'Aug 17–Aug 23, 2026'],
    ['month', -1, new Date(2026, 6, 1, 0, 0, 0).getTime(), 'July 2026'],
  ])('uses the same historical %s window for the focus score and attention field', (range, offset, expectedStart, expectedTitle) => {
    const result = buildDashboardData({
      ledger: emptyFocusLedger(),
      sessions: [],
      focusConfig: {},
      focusModeEnabled: false,
      range,
      offset,
      now: NOW,
    })

    const binWidth = result.attention[1].timestamp - result.attention[0].timestamp
    const attentionEnd = result.attention.at(-1).timestamp + binWidth
    expect(result.period).toMatchObject({ range, offset, title: expectedTitle })
    expect(result.attention[0].timestamp).toBe(expectedStart)
    expect(result.attention[0].timestamp).toBe(result.period.start.getTime())
    expect(Math.round(attentionEnd)).toBe(result.period.endExclusive.getTime())
    expect(result.attention.every(bin => bin.state !== 'future')).toBe(true)
  })

  it('retrieves measured attention from the previous day', () => {
    const start = new Date(2026, 7, 24, 8, 0, 0).getTime()
    const bins = buildAttentionField([{
      startedAt: start,
      timestamp: start + 10 * 60 * 1000,
      actualSeconds: 10 * 60,
      attentionScoringVersion: NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion,
      timeline: [{ second: 60, score: 82 }],
    }], { range: 'day', offset: -1, now: NOW, bins: 24 })

    expect(bins[0].timestamp).toBe(new Date(2026, 7, 24, 0, 0, 0).getTime())
    expect(bins[8]).toMatchObject({ state: 'strong', score: 82 })
    expect(bins.every(bin => bin.state !== 'future')).toBe(true)
  })

  it('does not carry a session ending at midnight into the next day', () => {
    const endedAt = new Date(2026, 7, 25, 0, 0, 0).getTime()
    const bins = buildAttentionField([{
      startedAt: endedAt - 30 * 60 * 1000,
      timestamp: endedAt,
      actualSeconds: 30 * 60,
      attentionScoringVersion: NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion,
      timeline: [{ second: 60, score: 82 }],
    }], { range: 'day', now: NOW, bins: 24 })

    expect(bins[0]).toMatchObject({ state: 'inactive', score: null })
  })

  it('keeps the score and attention field empty for a past period measured with an older ruler', () => {
    const julyStart = new Date(2026, 6, 15, 9, 0, 0).getTime()
    const currentStart = new Date(2026, 7, 25, 9, 0, 0).getTime()
    const olderSession = {
      id: 'older-ruler',
      startedAt: julyStart,
      timestamp: julyStart + 600_000,
      actualSeconds: 600,
      attentionScoringVersion: ATTENTION_SCORING_VERSION,
      timeline: [{ second: 60, score: 82 }],
    }
    const currentSession = {
      id: 'current-ruler',
      startedAt: currentStart,
      timestamp: currentStart + 600_000,
      actualSeconds: 600,
      attentionScoringVersion: NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion,
      timeline: [{ second: 60, score: 82 }],
    }
    const ledger = {
      schemaVersion: 1,
      days: {
        '2026-07-15': {
          sessions: {
            [olderSession.id]: {
              version: 1,
              generation: ATTENTION_SCORING_VERSION,
              measuredSeconds: 600,
              scoreSum: 46_800,
              deepFocusSeconds: 600,
            },
          },
        },
      },
    }
    const result = buildDashboardData({
      ledger,
      sessions: [currentSession, olderSession],
      focusConfig: {},
      focusModeEnabled: false,
      range: 'month',
      offset: -1,
      now: NOW,
    })

    expect(result.period.score).toBeNull()
    expect(result.attention.every(bin => ['inactive', 'no-signal', 'paused', 'future'].includes(bin.state))).toBe(true)
  })

  it('uses the same 25-hour calendar day across the DST fallback', () => {
    const previousTimezone = process.env.TZ
    process.env.TZ = 'Europe/Vienna'
    try {
      const now = new Date(2026, 9, 25, 12, 0, 0).getTime()
      const result = buildDashboardData({
        ledger: emptyFocusLedger(),
        sessions: [],
        focusConfig: {},
        focusModeEnabled: false,
        range: 'day',
        now,
      })
      const binWidth = result.attention[1].timestamp - result.attention[0].timestamp

      expect(result.period.endExclusive.getTime() - result.period.start.getTime()).toBe(25 * 60 * 60 * 1000)
      expect(Math.round(binWidth * result.attention.length)).toBe(25 * 60 * 60 * 1000)
    } finally {
      if (previousTimezone == null) delete process.env.TZ
      else process.env.TZ = previousTimezone
    }
  })

  it('keeps both signals on the same February month boundary', () => {
    const now = new Date(2026, 2, 15, 12, 0, 0).getTime()
    const result = buildDashboardData({
      ledger: emptyFocusLedger(),
      sessions: [],
      focusConfig: {},
      focusModeEnabled: false,
      range: 'month',
      offset: -1,
      now,
    })
    const binWidth = result.attention[1].timestamp - result.attention[0].timestamp

    expect(result.period.title).toBe('February 2026')
    expect(result.period.endExclusive.getTime() - result.period.start.getTime()).toBe(28 * 24 * 60 * 60 * 1000)
    expect(Math.round(binWidth * result.attention.length)).toBe(28 * 24 * 60 * 60 * 1000)
  })

  it('never calls idle protection active', () => {
    const base = {
      ledger: emptyFocusLedger(), sessions: [], range: 'day', now: NOW,
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

  it('counts a migrated domain-only rule once instead of as an app and a website', () => {
    const result = buildDashboardData({
      ledger: emptyFocusLedger(),
      sessions: [],
      range: 'day',
      now: NOW,
      focusModeEnabled: true,
      focusConfig: { distractionApps: ['reddit.com', 'Slack'], distractionDomains: ['reddit.com'] },
      nativeStatus: { checked: true, connected: true, helperInstalled: true },
    }).protection

    expect(result).toEqual({ state: 'ready', label: 'Ready', detail: '1 app · 1 website' })
  })

  it('keeps a domain-only setup configured and asks for the website helper', () => {
    const base = { ledger: emptyFocusLedger(), sessions: [], range: 'day', now: NOW, focusModeEnabled: true }
    const focusConfig = { distractionApps: ['reddit.com'], distractionDomains: ['reddit.com'] }

    expect(buildDashboardData({ ...base, focusConfig }).protection.state).toBe('checking')
    expect(buildDashboardData({ ...base, focusConfig, nativeStatus: { checked: true, connected: false } }).protection.state).toBe('disconnected')
    expect(buildDashboardData({ ...base, focusConfig, nativeStatus: { checked: true, connected: true, helperInstalled: false } }).protection.state).toBe('helper')
  })

  it('treats strict mode as configured protection even without an explicit blocklist', () => {
    const result = buildDashboardData({
      ledger: emptyFocusLedger(),
      sessions: [],
      range: 'day',
      now: NOW,
      focusModeEnabled: true,
      focusConfig: { strictMode: true, distractionApps: [], distractionDomains: [] },
      nativeStatus: { checked: true, connected: true, helperInstalled: true },
    }).protection

    expect(result.state).toBe('ready')
    expect(result.detail).toContain('Strict')
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

  it('counts a measured session even when its goal is not marked done', () => {
    const session = {
      id: 'unfinished-goal',
      startedAt: new Date(2026, 7, 25, 9).getTime(),
      timestamp: new Date(2026, 7, 25, 10).getTime(),
      actualSeconds: 3600,
      measuredSeconds: 3580,
      scoreSum: 214800,
      focusedSeconds: 3000,
      attentionScoringVersion: ATTENTION_SCORING_VERSION,
      focusMetricVersion: 1,
      focusMetricRejection: null,
      sessionEfficiency: 60,
      deepFocusSeconds: 3580,
      goalOutcome: null,
    }
    const ledger = {
      schemaVersion: 1,
      days: {
        '2026-08-25': {
          sessions: {
            [session.id]: { version: 1, measuredSeconds: 3580, scoreSum: 214800, deepFocusSeconds: 3580 },
          },
        },
      },
    }
    expect(buildDashboardData({ ledger, sessions: [session], focusConfig: {}, focusModeEnabled: false, now: NOW }).period.score)
      .not.toBeNull()
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
