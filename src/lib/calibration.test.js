import { describe, it, expect } from 'vitest'
import {
  MIN_SESSIONS,
  calibrate,
  durationFit,
  isUsable,
  planningFit,
  suggestNextSession,
  suggestedSessionMinutes,
  timeOfDayFit,
} from './calibration'

// A session that ENDED at `hour` today, having run `mins` minutes with
// `pct`% of that time focused.
function session({ hour = 10, mins = 50, pct = 70, planned = 50, extra = {} } = {}) {
  const end = new Date()
  end.setHours(hour, 0, 0, 0)
  const actualSeconds = mins * 60
  return {
    timestamp: end.getTime() + actualSeconds * 1000,
    actualSeconds,
    focusedSeconds: Math.round(actualSeconds * (pct / 100)),
    plannedDuration: planned,
    completed: true,
    ...extra,
  }
}

const many = (n, opts) => Array.from({ length: n }, () => session(opts))

// The most important behaviour in this module is refusal. A tool that produces
// a confident sentence from four sessions is a horoscope.
describe('refuses to speak from thin data', () => {
  it('says nothing at all below the session floor', () => {
    const c = calibrate(many(MIN_SESSIONS - 1))
    expect(c.ready).toBe(false)
    expect(c.needMore).toBe(1)
    expect(c.insights).toEqual([])
  })

  it('reports how many more are needed rather than a vague message', () => {
    expect(calibrate(many(3)).needMore).toBe(MIN_SESSIONS - 3)
    expect(calibrate([]).needMore).toBe(MIN_SESSIONS)
  })

  it('ignores sessions where focus was never measured', () => {
    const faulted = many(20, { extra: { trackingFaulted: true } })
    expect(calibrate(faulted).ready).toBe(false)
    expect(isUsable(faulted[0])).toBe(false)
  })

  it('ignores sessions too short to mean anything', () => {
    expect(isUsable(session({ mins: 1 }))).toBe(false)
    expect(isUsable(session({ mins: 10 }))).toBe(true)
  })

  it('does not rank times of day from one session each', () => {
    const spread = [
      session({ hour: 7 }), session({ hour: 10 }), session({ hour: 13 }),
      session({ hour: 16 }), session({ hour: 19 }), session({ hour: 23 }),
    ]
    expect(timeOfDayFit(spread).best).toBeNull()
  })

  it('does not call a small difference a pattern', () => {
    // 72% vs 68% is noise, not a finding.
    const s = [...many(4, { hour: 10, pct: 72 }), ...many(4, { hour: 16, pct: 68 })]
    expect(timeOfDayFit(s).best).toBeNull()
  })
})

describe('finds a real pattern when one exists', () => {
  const morningPerson = [
    ...many(5, { hour: 10, pct: 82 }),
    ...many(5, { hour: 16, pct: 48 }),
  ]

  it('names the best and worst window with the sample behind it', () => {
    const { best, worst } = timeOfDayFit(morningPerson)
    expect(best.label).toBe('late morning')
    expect(best.focusPct).toBe(82)
    expect(best.n).toBe(5)
    expect(worst.label).toBe('afternoon')
  })

  it('turns it into one sentence carrying both numbers', () => {
    const c = calibrate(morningPerson)
    expect(c.ready).toBe(true)
    const insight = c.insights.find(i => i.kind === 'time_of_day')
    expect(insight.text).toContain('82%')
    expect(insight.text).toContain('48%')
  })

  it('tells you whether you are in that window right now', () => {
    const at10 = new Date(); at10.setHours(10, 30, 0, 0)
    const at20 = new Date(); at20.setHours(20, 0, 0, 0)
    expect(suggestNextSession(morningPerson, at10).inWindow).toBe(true)
    expect(suggestNextSession(morningPerson, at20).inWindow).toBe(false)
  })
})

describe('planning fit', () => {
  it('spots consistently over-planning', () => {
    const overPlanner = many(6, { planned: 90, mins: 40, extra: { completed: false } })
    const p = planningFit(overPlanner)
    expect(p.plannedMedian).toBe(90)
    expect(p.actualMedian).toBe(40)
    expect(p.ratio).toBeLessThan(0.7)
    expect(calibrate(many(8, { planned: 90, mins: 40, extra: { completed: false } }))
      .insights.some(i => i.kind === 'planning')).toBe(true)
  })

  it('ignores sessions that ran to the timer — they say nothing about the estimate', () => {
    expect(planningFit(many(6, { planned: 50, mins: 50, extra: { completed: true } }))).toBeNull()
  })
})

describe('duration fit', () => {
  it('reports when a shorter block genuinely beats a longer one', () => {
    const s = [
      ...many(4, { planned: 50, mins: 50, pct: 80 }),
      ...many(4, { planned: 90, mins: 90, pct: 55 }),
    ]
    const d = durationFit(s)
    expect(d.best.minutes).toBe(50)
    expect(d.shorterIsBetter).not.toBeNull()
    expect(d.shorterIsBetter.longest.minutes).toBe(90)
  })

  it('stays quiet when longer is simply fine', () => {
    const s = [
      ...many(4, { planned: 50, mins: 50, pct: 70 }),
      ...many(4, { planned: 90, mins: 90, pct: 72 }),
    ]
    expect(durationFit(s).shorterIsBetter).toBeNull()
  })
})

describe('robustness', () => {
  it('survives malformed and legacy records without throwing', () => {
    const junk = [null, undefined, {}, { timestamp: NaN }, { actualSeconds: 0 }]
    expect(() => calibrate(junk)).not.toThrow()
    expect(calibrate(junk).ready).toBe(false)
  })

  it('never divides by zero on a zero-length session', () => {
    expect(() => calibrate([session({ mins: 0 }), ...many(10)])).not.toThrow()
  })
})

describe('sizing a plan step', () => {
  it('returns nothing until history can say', () => {
    expect(suggestedSessionMinutes([])).toBeNull()
    expect(suggestedSessionMinutes(many(5))).toBeNull()
  })

  it('prefers the length that measurably holds attention', () => {
    const s = [
      ...many(4, { planned: 50, mins: 50, pct: 82 }),
      ...many(4, { planned: 90, mins: 90, pct: 51 }),
    ]
    expect(suggestedSessionMinutes(s)).toMatchObject({ minutes: 50, focusPct: 82, n: 4 })
  })
})
