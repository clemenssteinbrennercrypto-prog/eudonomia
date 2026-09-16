import { describe, expect, it } from 'vitest'
import { buildFocusPeriod } from './focusMetric'
import { buildFocusPeriodV2, calculateFocusV2, FOCUS_METRIC_V2 } from './focusMetricV2'

const plan = { version: 1, plans: [{ effectiveFrom: '2026-09-14', workdays: [1, 2, 3, 4, 5] }] }
const at = (day, hour = 12) => new Date(2026, 8, day, hour)
const contribution = (minutes = 120, attention = 80, extra = {}) => ({
  version: 1, generation: 2, measuredSeconds: minutes * 60,
  scoreSum: minutes * 60 * attention, deepFocusSeconds: minutes * 60, ...extra,
})
const ledger = days => ({ schemaVersion: 1, days: Object.fromEntries(Object.entries(days).map(([day, item]) => [
  `2026-09-${day}`, { sessions: { [day]: item } },
])) })

describe('Focus Metric V2: separate, continuous time and attention ruler', () => {
  it('fixes the 54-to-55 phase inversion without rewriting V1', () => {
    const data = ledger({
      14: contribution(120, 54, { deepFocusSeconds: 3600 }),
      15: contribution(120, 55, { deepFocusSeconds: 1440 }),
    })
    const before = structuredClone(data)
    const legacy = buildFocusPeriod(data, { range: 'week', now: at(16) })
    const next = buildFocusPeriodV2(data, { range: 'week', now: at(16), schedule: plan })
    expect(legacy.days.slice(0, 2).map(day => day.score)).toEqual([50, 42])
    expect(next.days[1].rawScore).toBeGreaterThan(next.days[0].rawScore)
    expect(next.days[0].rawScore).toBeCloseTo(54 * .9)
    expect(next).toMatchObject({ metricVersion: 2, calculationSource: 'qualified_ledger_accumulators_v1', baseline: null })
    expect(data).toEqual(before)
    expect(buildFocusPeriod(data, { range: 'week', now: at(16) })).toEqual(legacy)
  })

  it('increases with attention at fixed duration throughout the full range', () => {
    for (const minutes of [5, 30, 120, 480]) {
      for (let attention = 0; attention < 100; attention++) {
        expect(calculateFocusV2(contribution(minutes, attention + 1)).rawScore)
          .toBeGreaterThan(calculateFocusV2(contribution(minutes, attention)).rawScore)
      }
    }
  })

  it('rewards equal-quality time with diminishing returns and a bounded score', () => {
    const scores = [30, 60, 90, 120, 240, 480].map(minutes => calculateFocusV2(contribution(minutes, 80)).rawScore)
    expect(scores[1] - scores[0]).toBeGreaterThan(scores[2] - scores[1])
    expect(scores.every((score, i) => score >= 0 && score <= 80 && (i === 0 || score > scores[i - 1]))).toBe(true)
    expect(calculateFocusV2(contribution(FOCUS_METRIC_V2.referenceMinutes, 80)).rawScore).toBeCloseTo(72)
  })

  it('never improves when zero-attention time is appended', () => {
    for (const minutes of [5, 30, 120, 240]) {
      const before = contribution(minutes, 80)
      expect(calculateFocusV2({ ...before, measuredSeconds: before.measuredSeconds + 1800 }).rawScore)
        .toBeLessThan(calculateFocusV2(before).rawScore)
    }
  })

  it('counts a truly measured zero as measurement, while absent measurement stays absent', () => {
    const data = ledger({ 14: contribution(120, 0, { deepFocusSeconds: 0 }) })
    const period = buildFocusPeriodV2(data, { range: 'week', now: at(15), schedule: plan })
    expect(period).toMatchObject({ score: 0, activeDays: 1, consistency: { completedDays: 1, percent: 100 } })
    expect(buildFocusPeriodV2(ledger({}), { range: 'week', now: at(16), schedule: plan }))
      .toMatchObject({ score: null, rawScore: null, consistency: { percent: 0 } })
  })

  it('never allows phases or self-reported energy to change V2', () => {
    const base = contribution()
    expect(calculateFocusV2(base)).toEqual(calculateFocusV2({ ...base, deepFocusSeconds: 0, energyLevel: 'tired' }))
  })

  it('weights raw seconds before the formula and ignores how qualifying sessions are split', () => {
    const data = ledger({ 14: contribution() })
    data.days['2026-09-14'].sessions = { short: contribution(10, 20), long: contribution(110, 80) }
    const day = buildFocusPeriodV2(data, { range: 'day', now: at(14) })
    expect(day.rawScore).toBeCloseTo(calculateFocusV2(contribution(120, 75)).rawScore)
  })

  it('preserves refusal, future-date and camera-generation boundaries', () => {
    const data = ledger({
      14: contribution(120, 80, { generation: 1 }),
      15: contribution(),
      16: contribution(1),
      17: contribution(120, 80, { generation: 99 }),
      18: contribution(),
    })
    const period = buildFocusPeriodV2(data, { range: 'week', now: at(17), schedule: plan })
    expect(period.days.map(day => day.status)).toEqual([
      'different_generation', 'measured', 'unmeasured', 'unmeasured', 'future', 'future', 'future',
    ])
    expect(period.activeDays).toBe(1)
    expect(period.measuredSeconds).toBe(7200)
  })

  it.each([
    { measuredSeconds: 0, scoreSum: 0 },
    { measuredSeconds: 600, scoreSum: -1 },
    { measuredSeconds: 600, scoreSum: 60001 },
    { measuredSeconds: Infinity, scoreSum: 100 },
    { measuredSeconds: 600, scoreSum: NaN },
  ])('rejects invalid raw totals %s', totals => expect(calculateFocusV2(totals)).toBeNull())
})

describe('V2 consistency over elapsed planned days', () => {
  it('leaves Monday’s 72 intact on Tuesday morning and counts Tuesday only after it ends', () => {
    const data = ledger({ 14: contribution() })
    const tuesday = buildFocusPeriodV2(data, { range: 'week', now: at(15), schedule: plan })
    const wednesday = buildFocusPeriodV2(data, { range: 'week', now: at(16), schedule: plan })
    expect(tuesday).toMatchObject({ score: 72, consistency: { completedDays: 1, eligibleDays: 1, percent: 100 } })
    expect(wednesday).toMatchObject({ score: 63, consistency: { completedDays: 1, eligibleDays: 2, percent: 50 } })
  })

  it('rewards showing up on another planned day at the same time and quality', () => {
    const missed = ledger({ 14: contribution() })
    const completed = ledger({ 14: contribution(), 15: contribution() })
    expect(buildFocusPeriodV2(completed, { range: 'week', now: at(16), schedule: plan }).score)
      .toBeGreaterThan(buildFocusPeriodV2(missed, { range: 'week', now: at(16), schedule: plan }).score)
  })

  it('does not punish planned weekends, days before setup, or camera failures', () => {
    const data = ledger({ 18: contribution(), 17: { version: 1, status: 'unmeasured', rejection: 'invalid_measurement' } })
    const schedule = { version: 1, plans: [{ effectiveFrom: '2026-09-17', workdays: [1, 2, 3, 4, 5] }] }
    const period = buildFocusPeriodV2(data, { range: 'week', now: at(20, 23), schedule })
    expect(period).toMatchObject({ score: 72, consistency: { completedDays: 1, eligibleDays: 1, unknownDays: 1 } })
  })

  it('uses the plan that applied on each date and leaves earlier periods stable', () => {
    const schedule = { version: 1, plans: [...plan.plans, { effectiveFrom: '2026-09-17', workdays: [4, 5] }] }
    const data = ledger({ 14: contribution(), 18: contribution() })
    const original = buildFocusPeriodV2(data, { range: 'week', now: at(20), schedule })
    const edited = { version: 1, plans: [...schedule.plans, { effectiveFrom: '2026-09-21', workdays: [0, 6] }] }
    expect(buildFocusPeriodV2(data, { range: 'week', periodStart: at(14), now: at(23), schedule: edited }).rawScore)
      .toBe(original.rawScore)
    expect(original.consistency).toMatchObject({ completedDays: 2, eligibleDays: 5 })
  })

  it('does not apply a weekly consistency adjustment to a daily score', () => {
    expect(buildFocusPeriodV2(ledger({ 18: contribution() }), { range: 'day', now: at(18), schedule: plan }).score).toBe(72)
  })

  it('makes no consistency claim without a dated plan', () => {
    expect(buildFocusPeriodV2(ledger({ 14: contribution() }), { range: 'week', now: at(18) }))
      .toMatchObject({ score: 72, consistency: { fraction: null, factor: 1 } })
  })
})
