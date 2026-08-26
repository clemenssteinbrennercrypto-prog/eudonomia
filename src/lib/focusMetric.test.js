import { describe, expect, it } from 'vitest'
import {
  ATTENTION_SCORING_VERSION,
  FOCUS_METRIC_V1,
  addSessionToFocusLedger,
  backfillFocusLedger,
  buildFocusMetricDiagnostics,
  buildFocusPeriod,
  calculateDailyFocus,
  deriveSessionFocusMetric,
  emptyFocusLedger,
  recoverLegacyTimelineMeasurement,
  recoverThrottledTimerMeasurement,
  removeSessionFromFocusLedger,
  withSessionFocusMetric,
} from './focusMetric'
import { ATTENTION_ACCUMULATION_VERSION } from './attentionSampling'

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

// Unlike measuredSession, this stops short of deriveSessionFocusMetric — it
// models what an older build (one that predates the ledger, or predates
// focusMetricVersion/sessionEfficiency entirely) would have actually saved:
// real measurement fields, no derived ones.
function rawSession({
  id = 'session-1',
  startedAt = new Date(2026, 7, 17, 9).getTime(),
  measuredSeconds = 3600,
  actualSeconds = measuredSeconds + 20,
  efficiency = 80,
  phase = 'lock_in',
} = {}) {
  return {
    id,
    startedAt,
    timestamp: startedAt + actualSeconds * 1000,
    attentionScoringVersion: ATTENTION_SCORING_VERSION,
    actualSeconds,
    measuredSeconds,
    scoreSum: measuredSeconds * efficiency,
    focusPhases: { seconds: phaseSeconds(measuredSeconds, phase) },
  }
}

function legacyTimelineSession({
  id = 'legacy-timeline',
  startedAt = new Date(2026, 7, 17, 9).getTime(),
  measuredSeconds = 600,
  actualSeconds = measuredSeconds + 20,
  score = 84,
} = {}) {
  return {
    id,
    startedAt,
    timestamp: startedAt + actualSeconds * 1000,
    actualSeconds,
    focusedSeconds: Math.round(measuredSeconds * 0.9),
    avgFocusScore: score,
    timeline: Array.from(
      { length: Math.floor(measuredSeconds / FOCUS_METRIC_V1.legacyTimelineSampleSeconds) },
      (_, index) => ({ second: 20 + (index + 1) * 5, score, focused: score >= 40 })
    ),
    focusPhases: { seconds: phaseSeconds(measuredSeconds, 'lock_in') },
  }
}

function throttledTimerSession({
  id = 'throttled-timer',
  actualSeconds = 620,
  measuredSeconds = 300,
  score = 78,
  sampleEvery = 10,
} = {}) {
  const startedAt = new Date(2026, 7, 17, 9).getTime()
  return {
    id,
    startedAt,
    timestamp: startedAt + actualSeconds * 1000,
    attentionScoringVersion: ATTENTION_SCORING_VERSION,
    actualSeconds,
    measuredSeconds,
    scoreSum: measuredSeconds * score,
    focusedSeconds: measuredSeconds,
    scoreMeasured: true,
    timeline: Array.from(
      { length: Math.floor((actualSeconds - FOCUS_METRIC_V1.calibrationSeconds) / sampleEvery) },
      (_, index) => ({
        second: FOCUS_METRIC_V1.calibrationSeconds + index * sampleEvery,
        score,
        focused: true,
        phase: 'lock_in',
      })
    ),
    focusPhases: { seconds: phaseSeconds(measuredSeconds, 'lock_in') },
  }
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

  it('scores real measured segments without turning session gaps into data', () => {
    const session = measuredSession({ measuredSeconds: 300, actualSeconds: 421 })
    expect(session.measurementCoverage).toBeLessThan(0.8)
    expect(session.focusMetricRejection).toBeNull()
    expect(session.sessionEfficiency).toBe(80)
  })

  it('rejects phase totals that do not match measured time', () => {
    const session = measuredSession()
    session.focusPhases.seconds.lock_in -= 10
    expect(deriveSessionFocusMetric(session).focusMetricRejection).toBe('invalid_measurement')
  })

  it('keeps a genuinely zero efficiency at zero', () => {
    expect(measuredSession({ efficiency: 0 })).toMatchObject({
      sessionEfficiency: 0,
      focusMetricRejection: null,
    })
  })

  it('rejects more measured time than the session could contain', () => {
    const impossible = rawSession({ measuredSeconds: 602, actualSeconds: 620 })
    expect(deriveSessionFocusMetric(impossible)).toMatchObject({
      sessionEfficiency: null,
      focusMetricRejection: 'invalid_measurement',
    })
  })

  it('recovers pre-ledger sessions from real timeline and phase measurements', () => {
    const legacy = legacyTimelineSession()
    expect(recoverLegacyTimelineMeasurement(legacy)).toMatchObject({
      measuredSeconds: 600,
      scoreSum: 50_400,
      focusMeasurementSource: 'legacy_timeline_v1',
    })
    expect(deriveSessionFocusMetric(legacy)).toMatchObject({
      sessionEfficiency: 84,
      focusMetricRejection: null,
      focusMeasurementSource: 'legacy_timeline_v1',
    })
  })

  it('does not reconstruct history from focus percentage without raw score samples', () => {
    const legacy = legacyTimelineSession()
    delete legacy.timeline
    expect(recoverLegacyTimelineMeasurement(legacy)).toBeNull()
    expect(deriveSessionFocusMetric(legacy).focusMetricRejection).toBe('legacy_scoring_version')
  })

  it('rejects a sparse legacy timeline instead of overstating camera coverage', () => {
    const legacy = legacyTimelineSession()
    legacy.timeline = legacy.timeline.slice(0, 20)
    expect(recoverLegacyTimelineMeasurement(legacy)).toBeNull()
  })

  it('accepts skipped snapshot ticks when real samples still span the measured session', () => {
    const legacy = legacyTimelineSession()
    legacy.timeline = legacy.timeline.filter((_, index) => index % 3 === 0)
    expect(legacy.timeline).toHaveLength(40)
    expect(recoverLegacyTimelineMeasurement(legacy)).toMatchObject({
      measuredSeconds: 600,
      focusMeasurementSource: 'legacy_timeline_v1',
    })
  })

  it('recovers a timer-throttled session from dense samples spanning real time', () => {
    const recovered = recoverThrottledTimerMeasurement(throttledTimerSession())
    expect(recovered).toMatchObject({
      attentionAccumulationVersion: ATTENTION_ACCUMULATION_VERSION,
      measuredSeconds: 600,
      focusedSeconds: 600,
      scoreSum: 46_800,
      avgFocusScore: 78,
      focusMeasurementSource: 'timer_timeline_v2',
    })
    expect(recovered.focusPhases.seconds.lock_in).toBe(600)
    expect(deriveSessionFocusMetric(throttledTimerSession())).toMatchObject({
      sessionEfficiency: 78,
      deepFocusMinutes: 10,
      measurementCoverage: 1,
      focusMeasurementSource: 'timer_timeline_v2',
    })
  })

  it('refuses to fill an old session across a real timeline outage', () => {
    const session = throttledTimerSession()
    session.timeline = session.timeline.filter(sample => sample.second < 200 || sample.second > 300)
    expect(recoverThrottledTimerMeasurement(session)).toBeNull()
    expect(withSessionFocusMetric(session)).toMatchObject({
      measuredSeconds: 300,
      measurementCoverage: 0.5,
      focusMeasurementSource: 'live_v1',
    })
  })

  it('does not reinterpret sessions already written by the wall-clock accumulator', () => {
    const session = {
      ...throttledTimerSession(),
      attentionAccumulationVersion: ATTENTION_ACCUMULATION_VERSION,
    }
    expect(recoverThrottledTimerMeasurement(session)).toBeNull()
  })
})

describe('privacy-safe focus diagnostics', () => {
  it('reports measurement structure without private session content', () => {
    const session = {
      ...legacyTimelineSession(),
      task: 'PRIVATE TASK',
      goal: 'PRIVATE GOAL',
      timeline: legacyTimelineSession().timeline.map(sample => ({
        ...sample,
        activity: { label: 'PRIVATE WINDOW TITLE' },
      })),
      outputEvidence: { root: '/PRIVATE/PATH', changedNames: ['PRIVATE_FILE.txt'] },
    }
    const diagnostic = buildFocusMetricDiagnostics([session], emptyFocusLedger())
    const serialized = JSON.stringify(diagnostic)
    expect(serialized).not.toContain('PRIVATE')
    expect(diagnostic.sessions[0]).toMatchObject({
      phaseSeconds: 600,
      validScoreSamples: 120,
      recoveredFromLegacyTimeline: true,
      currentDerivedRejection: null,
      ledgerState: 'missing',
    })
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

  it('refuses a structurally valid ledger fragment below the five-minute floor', () => {
    expect(calculateDailyFocus({
      sessions: {
        thin: { version: 1, measuredSeconds: 299, scoreSum: 23_920, deepFocusSeconds: 299 },
      },
    })).toBeNull()
  })
})

describe('backfilling the ledger from already-stored sessions', () => {
  it('recovers a valid session an older build never added to the ledger', () => {
    const raw = rawSession({ id: 'never-ledgered' })
    const ledger = backfillFocusLedger(emptyFocusLedger(), [raw])
    expect(ledger.days['2026-08-17'].sessions['never-ledgered']).toBeTruthy()
    expect(calculateDailyFocus(ledger.days['2026-08-17']).score).not.toBeNull()
  })

  it('does not touch a session already present under its day', () => {
    const raw = rawSession({ id: 'present', efficiency: 80 })
    let ledger = addSessionToFocusLedger(emptyFocusLedger(), measuredSession({ id: 'present', efficiency: 80 }))
    const beforeValue = ledger.days['2026-08-17'].sessions['present']
    ledger = backfillFocusLedger(ledger, [raw])
    expect(ledger.days['2026-08-17'].sessions['present']).toBe(beforeValue)
  })

  it('marks a session that never tracked properly without estimating a score', () => {
    const tooShort = rawSession({ id: 'too-short', measuredSeconds: 100, actualSeconds: 120 })
    const ledger = backfillFocusLedger(emptyFocusLedger(), [tooShort])
    expect(ledger.days['2026-08-17'].sessions['too-short']).toMatchObject({ status: 'unmeasured' })
    expect(calculateDailyFocus(ledger.days['2026-08-17'])).toBeNull()
  })

  it('is a no-op over an already-complete ledger', () => {
    const raw = rawSession({ id: 'complete' })
    const first = backfillFocusLedger(emptyFocusLedger(), [raw])
    const second = backfillFocusLedger(first, [raw])
    expect(second).toEqual(first)
  })

  it('upgrades an existing unmeasured marker when legacy raw data can be recovered', () => {
    const legacy = legacyTimelineSession({ id: 'upgrade-marker' })
    const marked = addSessionToFocusLedger(emptyFocusLedger(), {
      ...legacy,
      focusMetricVersion: FOCUS_METRIC_V1.version,
      focusMetricRejection: 'legacy_scoring_version',
    })
    expect(marked.days['2026-08-17'].sessions['upgrade-marker'].status).toBe('unmeasured')

    const upgraded = backfillFocusLedger(marked, [legacy])
    expect(upgraded.days['2026-08-17'].sessions['upgrade-marker']).toMatchObject({
      source: 'legacy_timeline_v1',
      measuredSeconds: 600,
    })
    expect(calculateDailyFocus(upgraded.days['2026-08-17']).score).not.toBeNull()
  })

  it('upgrades a long measured session that an older build rejected for partial coverage', () => {
    const session = measuredSession({
      id: 'partial-coverage',
      measuredSeconds: 4450,
      actualSeconds: 7635,
      efficiency: 83,
    })
    const oldRejected = {
      ...session,
      sessionEfficiency: null,
      deepFocusMinutes: null,
      measurementCoverage: 0.584,
      focusMetricRejection: 'low_coverage',
    }
    const marked = addSessionToFocusLedger(emptyFocusLedger(), oldRejected)
    expect(marked.days['2026-08-17'].sessions['partial-coverage'].status).toBe('unmeasured')

    const upgraded = backfillFocusLedger(marked, [oldRejected])
    expect(upgraded.days['2026-08-17'].sessions['partial-coverage']).toMatchObject({
      measuredSeconds: 4450,
      source: 'live_v1',
    })
    expect(calculateDailyFocus(upgraded.days['2026-08-17']).score).not.toBeNull()
  })

  it('replaces an existing undercounted ledger contribution after timer recovery', () => {
    const session = throttledTimerSession({ id: 'replace-timer-count' })
    let ledger = addSessionToFocusLedger(emptyFocusLedger(), withSessionFocusMetric({
      ...session,
      timeline: [],
    }))
    expect(ledger.days['2026-08-17'].sessions['replace-timer-count'].measuredSeconds).toBe(300)

    ledger = backfillFocusLedger(ledger, [session])
    expect(ledger.days['2026-08-17'].sessions['replace-timer-count']).toMatchObject({
      measuredSeconds: 600,
      source: 'timer_timeline_v2',
    })
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

  it('scores elapsed no-activity days as zero without counting them as active', () => {
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
    expect(period.days[1]).toMatchObject({ score: 0, noActivity: true })
    expect(period.days[3].score).toBeUndefined()
    expect(period.activeDays).toBe(2)
    expect(period.elapsedDays).toBe(3)
    expect(period.score).not.toBeNull()
  })

  it('keeps an unmeasured session distinct from a no-activity zero', () => {
    const rejected = {
      ...rawSession({ id: 'camera-failed', measuredSeconds: 0, actualSeconds: 600 }),
      focusMetricVersion: FOCUS_METRIC_V1.version,
      focusMetricRejection: 'low_coverage',
    }
    const ledger = addSessionToFocusLedger(emptyFocusLedger(), rejected)
    const period = buildFocusPeriod(ledger, {
      range: 'week',
      now: new Date(2026, 7, 18, 18),
      sessions: [rejected],
    })
    expect(period.days[0].score).toBeUndefined()
    expect(period.days[1]).toMatchObject({ score: 0, noActivity: true })
  })

  it('returns zero for a day with no activity', () => {
    const period = buildFocusPeriod(emptyFocusLedger(), {
      range: 'day',
      now: new Date(2026, 7, 19, 18),
    })
    expect(period.score).toBe(0)
    expect(period.days[0]).toMatchObject({ score: 0, noActivity: true })
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
