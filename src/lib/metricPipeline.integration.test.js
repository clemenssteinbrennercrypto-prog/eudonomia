import { beforeEach, describe, expect, it } from 'vitest'
import { NATIVE_CAMERA_MEASUREMENT_V2 } from './cameraMeasurement'
import { ATTENTION_ACCUMULATION_VERSION } from './attentionSampling'
import { withSessionFocusMetric } from './focusMetric'
import {
  aggregateAverageFocus,
  aggregateFocusMeasurements,
  buildHistoryTrend,
  sessionAverageFocus,
  sessionFocusPct,
} from './historyTrend'
import { buildDashboardData } from './dashboardData'
import { calibrate, MIN_SESSIONS } from './calibration'
import { analyzeSession } from './sessionAnalysis'
import { buildSessionSummary } from './sessionSummary'
import { createLocalSessionRepository } from './sessionRepository.local'
import { buildFullArchive, buildSessionsCSV } from '../components/analytics/Sessions'

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

const NOW = new Date(2026, 8, 1, 18, 0, 0).getTime()

function nativeV2Session(index) {
  const started = new Date(2026, 8, 1 - index, 9, 0, 0).getTime()
  const measuredSeconds = 600
  const actualSeconds = measuredSeconds + 20
  return withSessionFocusMetric({
    id: `native-v2-${index}`,
    startedAt: started,
    timestamp: started + actualSeconds * 1000,
    task: `Measured work ${index}`,
    goal: 'Complete the planned section',
    tags: ['deep-work'],
    plannedDuration: 15,
    actualSeconds,
    completed: true,
    goalOutcome: 'yes',
    energyLevel: 'medium',
    attentionScoringVersion: NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion,
    attentionMeasurementSource: NATIVE_CAMERA_MEASUREMENT_V2.id,
    attentionAccumulationVersion: ATTENTION_ACCUMULATION_VERSION,
    measuredSeconds,
    scoreSum: measuredSeconds * 78,
    focusedSeconds: 480,
    avgFocusScore: 78,
    finalScore: 78,
    scoreMeasured: true,
    trackingFaulted: false,
    distractionEvents: 1,
    longestFocusedStreak: 240,
    timeline: [
      { second: 20, score: 82, focused: true, phase: 'lock_in' },
      { second: 300, score: 55, focused: true, phase: 'lock_in' },
      { second: 600, score: 22, focused: false, phase: 'lock_in' },
    ],
    focusPhases: {
      seconds: { arrival: 0, ramp: 0, lock_in: measuredSeconds, fade: 0, recovery: 0, drift: 0 },
      dominant: 'lock_in',
    },
    workspace: { id: 'writing', name: 'Writing', revision: 1 },
  })
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
})

describe('native V2 metric pipeline', () => {
  it('keeps every metric connected from persistence through Lab, Analytics and exports', async () => {
    const repository = createLocalSessionRepository()
    const source = Array.from({ length: MIN_SESSIONS }, (_, index) => nativeV2Session(index))
    for (const session of [...source].reverse()) await repository.saveSession(session)

    const sessions = await repository.loadAll()
    const ledger = await repository.loadFocusLedger()
    const newest = sessions[0]

    // Persistence keeps the raw native signal and the versioned ledger
    // contribution together; every downstream metric starts from these.
    expect(newest).toMatchObject({
      attentionScoringVersion: NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion,
      attentionMeasurementSource: NATIVE_CAMERA_MEASUREMENT_V2.id,
      sessionEfficiency: 78,
      focusMetricRejection: null,
    })
    expect(newest.timeline).toHaveLength(3)
    expect(Object.values(ledger.days).every(day =>
      Object.values(day.sessions).every(item => item.generation === NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion)
    )).toBe(true)

    const lab = buildDashboardData({
      ledger,
      sessions,
      focusConfig: {},
      focusModeEnabled: false,
      scoreRange: 'day',
      fieldRange: 'day',
      now: NOW,
    })
    expect(lab.period).toMatchObject({
      generation: NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion,
      efficiency: 78,
      measuredSeconds: 600,
    })
    expect(lab.period.score).not.toBeNull()
    expect(lab.attention.some(bin => ['strong', 'focused', 'drift'].includes(bin.state))).toBe(true)
    expect(lab.recentSessions[0].efficiency).toBe(78)

    // Overview, Trends, Patterns, Sessions and the post-session report all
    // read the same V2 measurement rather than maintaining private formulas.
    expect(sessionAverageFocus(newest)).toBe(78)
    expect(sessionFocusPct(newest)).toBe(80)
    expect(aggregateAverageFocus(sessions)).toBe(78)
    expect(aggregateFocusMeasurements(sessions)).toMatchObject({
      sessionCount: MIN_SESSIONS,
      measuredSeconds: MIN_SESSIONS * 600,
      focusedSeconds: MIN_SESSIONS * 480,
      focusPct: 80,
    })
    const trend = buildHistoryTrend(sessions, { range: '30days', now: NOW })
    expect(trend.buckets.filter(bucket => bucket.avgFocus != null)).toHaveLength(MIN_SESSIONS)
    expect(trend.buckets.every(bucket => bucket.avgFocus == null || bucket.avgFocus === 78)).toBe(true)
    expect(calibrate(sessions)).toMatchObject({ ready: true, sessionsAnalysed: MIN_SESSIONS })
    expect(analyzeSession(newest, { priorSessions: sessions.slice(1) }).measurement).toMatchObject({
      scored: true,
      compatible: true,
      scoringVersion: NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion,
      averageFocus: 78,
      aboveThresholdPct: 80,
    })
    expect(buildSessionSummary(newest)).toMatchObject({ measured: true, measuredSeconds: 600 })
    expect((await repository.listSessionSummaries({ measurement: 'measured' })).total).toBe(MIN_SESSIONS)

    const repositoryArchive = await repository.exportArchive()
    expect(repositoryArchive.sessions).toHaveLength(MIN_SESSIONS)
    expect(repositoryArchive.focusLedger).toEqual(ledger)
    const archive = buildFullArchive(sessions, ledger, '2026-09-01T16:00:00.000Z')
    expect(archive.sessions[0].timeline).toEqual(newest.timeline)
    expect(archive.focusLedger).toEqual(ledger)

    const csv = buildSessionsCSV([newest])
    const [header, row] = csv.split('\n').map(line => line.split(','))
    expect(row[header.indexOf('averageFocus')]).toBe('78')
    expect(row[header.indexOf('timeAboveThresholdPct')]).toBe('80')
    expect(row[header.indexOf('measuredSeconds')]).toBe('600')
  })
})
