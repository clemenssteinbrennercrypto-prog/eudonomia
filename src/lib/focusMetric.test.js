import { describe, expect, it } from 'vitest'
import {
  ATTENTION_SCORING_VERSION,
  FOCUS_METRIC_V1,
  addSessionToFocusLedger,
  buildFocusPeriod,
  calculateDailyFocus,
  deriveSessionFocusMetric,
  emptyFocusLedger,
  removeSessionFromFocusLedger,
} from './focusMetric'

function phaseSeconds(total, phase = 'lock_in') {
  return { arrival: 0, ramp: 0, lock_in: 0, fade: 0, recovery: 0, drift: 0, [phase]: total }
}

function measuredSession({
  id = 'session-1',
  startedAt = new Date(2026, 7, 17, 9).getTime(),
  measuredSeconds = 3600,
  actualSeconds = measuredSeconds + 20,
  efficiency = 80,
  phase = 'lock_in',
} = {}) {
  const base = {
    id,
    startedAt,
    timestamp: startedAt + actualSeconds * 1000,
    attentionScoringVersion: ATTENTION_SCORING_VERSION,
    actualSeconds,
    measuredSeconds,
    scoreSum: measuredSeconds * efficiency,
    focusPhases: { seconds: phaseSeconds(measuredSeconds, phase) },
  }
  return { ...base, ...deriveSessionFocusMetric(base) }
}

function dailyEntry({ minutes, efficiency, phase = 'lock_in', id = 'x' }) {
  const session = measuredSession({ id, measuredSeconds: minutes * 60, efficiency, phase })
  return addSessionToFocusLedger(emptyFocusLedger(), session).days['2026-08-17']
}

describe('session focus metric refusals', () => {
  it('refuses legacy sessions rather than guessing from old fields', () => {
    const legacy = measuredSession()
    delete legacy.attentionScoringVersion
    expect(deriveSessionFocusMetric(legacy)).toMatchObject({
      sessionEfficiency: null,
      focusMetricRejection: 'legacy_scoring_version',
    })
  })

  it('requires five measured minutes', () => {
    const session = measuredSession({ measuredSeconds: 299, actualSeconds: 319 })
    expect(session.sessionEfficiency).toBeNull()
    expect(session.focusMetricRejection).toBe('insufficient_duration')
  })

  it('requires eighty percent post-calibration coverage', () => {
    const session = measuredSession({ measuredSeconds: 300, actualSeconds: 421 })
    expect(session.measurementCoverage).toBeLessThan(0.8)
    expect(session.focusMetricRejection).toBe('low_coverage')
  })

  it('rejects phase totals that do not match measured time', () => {
    const session = measuredSession()
    session.focusPhases.seconds.lock_in -= 10
    expect(deriveSessionFocusMetric(session).focusMetricRejection).toBe('invalid_measurement')
  })
})

describe('daily focus formula', () => {
  it('keeps the estimated constants named and ordered', () => {
    expect(FOCUS_METRIC_V1.efficiencyExponent).toBeGreaterThan(FOCUS_METRIC_V1.volumeExponent)
    expect(FOCUS_METRIC_V1.phaseWeights.lock_in).toBeGreaterThan(FOCUS_METRIC_V1.phaseWeights.ramp)
    expect(FOCUS_METRIC_V1.phaseWeights.ramp).toBeGreaterThan(FOCUS_METRIC_V1.phaseWeights.fade)
    expect(FOCUS_METRIC_V1.phaseWeights.fade).toBeGreaterThan(FOCUS_METRIC_V1.phaseWeights.drift)
  })

  it('lets four excellent hours beat eight poor hours', () => {
    const excellent = calculateDailyFocus(dailyEntry({ minutes: 240, efficiency: 95 }))
    const poor = calculateDailyFocus(dailyEntry({ minutes: 480, efficiency: 45, phase: 'fade' }))
    expect(excellent.score).toBeGreaterThan(poor.score)
  })

  it('rewards more equally efficient time with diminishing returns', () => {
    const twoHours = calculateDailyFocus(dailyEntry({ minutes: 120, efficiency: 95 }))
    const fourHours = calculateDailyFocus(dailyEntry({ minutes: 240, efficiency: 95 }))
    const sevenHours = calculateDailyFocus(dailyEntry({ minutes: 420, efficiency: 95 }))
    expect(fourHours.score).toBeGreaterThan(twoHours.score)
    expect(sevenHours.score).toBeGreaterThan(fourHours.score)
    expect(sevenHours.score - fourHours.score).toBeLessThan(fourHours.score - twoHours.score)
  })

  it('keeps short excellent days visibly provisional through volume qualification', () => {
    const thirty = calculateDailyFocus(dailyEntry({ minutes: 30, efficiency: 95 }))
    const sixty = calculateDailyFocus(dailyEntry({ minutes: 60, efficiency: 95 }))
    const twoHours = calculateDailyFocus(dailyEntry({ minutes: 120, efficiency: 95 }))
    expect(thirty.score).toBeLessThan(sixty.score)
    expect(sixty.score).toBeLessThan(twoHours.score)
    expect(thirty.volumeQualification).toBeCloseTo(0.5)
    expect(twoHours.volumeQualification).toBe(1)
  })

  it('does not let energy, goals, or baselines move the ruler', () => {
    const base = dailyEntry({ minutes: 120, efficiency: 80 })
    expect(calculateDailyFocus({ ...base, energyLevel: 'tired', goal: 'ship it', baseline: 99 }))
      .toEqual(calculateDailyFocus(base))
  })

  it('refuses malformed ledger contributions instead of diluting the day', () => {
    expect(calculateDailyFocus({
      sessions: {
        broken: { version: 1, measuredSeconds: 60, scoreSum: 60_000, deepFocusSeconds: 60 },
      },
    })).toBeNull()
  })
})

describe('daily ledger and calendar periods', () => {
  it('is idempotent per session and removes only the requested contribution', () => {
    const first = measuredSession({ id: 'a' })
    const second = measuredSession({ id: 'b', efficiency: 60 })
    let ledger = addSessionToFocusLedger(emptyFocusLedger(), first)
    ledger = addSessionToFocusLedger(ledger, first)
    ledger = addSessionToFocusLedger(ledger, second)
    expect(Object.keys(ledger.days['2026-08-17'].sessions)).toHaveLength(2)
    ledger = removeSessionFromFocusLedger(ledger, 'a')
    expect(Object.keys(ledger.days['2026-08-17'].sessions)).toEqual(['b'])
  })

  it('averages measured days and reports missing days only as coverage', () => {
    let ledger = addSessionToFocusLedger(emptyFocusLedger(), measuredSession({ id: 'mon' }))
    ledger = addSessionToFocusLedger(ledger, measuredSession({
      id: 'wed',
      startedAt: new Date(2026, 7, 19, 9).getTime(),
      efficiency: 60,
    }))
    const period = buildFocusPeriod(ledger, {
      range: 'week',
      now: new Date(2026, 7, 19, 18),
    })
    expect(period.days).toHaveLength(7)
    expect(period.activeDays).toBe(2)
    expect(period.elapsedDays).toBe(3)
    expect(period.score).not.toBeNull()
  })

  it('uses Monday as the calendar-week boundary', () => {
    const period = buildFocusPeriod(emptyFocusLedger(), {
      range: 'week',
      now: new Date(2026, 7, 19, 18),
    })
    expect(period.days[0].key).toBe('2026-08-17')
    expect(period.days[6].key).toBe('2026-08-23')
  })

  it('keeps today from breaking a streak that was active yesterday', () => {
    let ledger = addSessionToFocusLedger(emptyFocusLedger(), measuredSession({
      id: 'mon',
      startedAt: new Date(2026, 7, 17, 9).getTime(),
    }))
    ledger = addSessionToFocusLedger(ledger, measuredSession({
      id: 'tue',
      startedAt: new Date(2026, 7, 18, 9).getTime(),
    }))
    expect(buildFocusPeriod(ledger, { range: 'week', now: new Date(2026, 7, 19, 9) }).streak).toBe(2)
  })
})
