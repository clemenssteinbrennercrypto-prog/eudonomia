import { describe, it, expect } from 'vitest'
import {
  MIN_SESSIONS,
  activityAlignmentFit,
  calibrate,
  driftRecoveryFit,
  durationFit,
  energyFit,
  isUsable,
  outcomeFit,
  outputEvidenceFit,
  planningFit,
  suggestNextSession,
  timeOfDayFit,
  weekdayFit,
  workspaceFit,
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
    // Real records carry the mean attention score, which is what patterns
    // compare on; a fixture without it is not a session the app ever writes.
    avgFocusScore: pct,
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

  it('does not calibrate V1 history with the separate native V2 ruler', () => {
    const nativeV2 = many(MIN_SESSIONS, { extra: { attentionScoringVersion: 2 } })
    expect(calibrate(nativeV2)).toMatchObject({ ready: false, needMore: MIN_SESSIONS })
  })

  it('ignores sessions too short to mean anything', () => {
    expect(isUsable(session({ mins: 1 }))).toBe(false)
    expect(isUsable(session({ mins: 10 }))).toBe(true)
  })

  it('does not treat an unmeasured camera gap as poor focus', () => {
    const partial = session({
      mins: 60,
      pct: 25,
      extra: { measuredSeconds: 1800, focusedSeconds: 900, avgFocusScore: 50 },
    })
    expect(timeOfDayFit([partial, partial, partial]).ranked[0].focusPct).toBe(50)
  })

  it('does not use a faulted session as cross-session calibration evidence', () => {
    const partial = session({
      mins: 30,
      extra: {
        trackingFaulted: true,
        avgFocusScore: 75,
        measuredSeconds: 900,
        focusedSeconds: 675,
      },
    })
    expect(isUsable(partial)).toBe(false)
    expect(calibrate(Array.from({ length: MIN_SESSIONS }, () => partial))).toMatchObject({
      ready: false,
      needMore: MIN_SESSIONS,
    })
  })

  it('refuses a long wall-clock session with zero measured seconds', () => {
    expect(isUsable(session({ mins: 60, extra: { measuredSeconds: 0, focusedSeconds: 0 } }))).toBe(false)
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

// Fixed timestamp, not `hour`-relative like session() above — these axes
// bucket by calendar day, workspace, energy, drift, activity, and output,
// none of which session()'s helper parameterizes.
function sessionAt(timestamp, pct, extra = {}) {
  const actualSeconds = 40 * 60
  return {
    timestamp,
    actualSeconds,
    focusedSeconds: Math.round(actualSeconds * (pct / 100)),
    avgFocusScore: pct,
    trackingFaulted: false,
    ...extra,
  }
}

describe('new Patterns axes', () => {
  it('weekdayFit finds a real day-of-week pattern', () => {
    const dayA = new Date(2026, 0, 5).getTime()
    const dayB = new Date(2026, 0, 6).getTime() // adjacent day -> different weekday
    const sessions = [
      ...Array.from({ length: 5 }, () => sessionAt(dayA, 88)),
      ...Array.from({ length: 5 }, () => sessionAt(dayB, 40)),
    ]
    const { best, worst } = weekdayFit(sessions)
    expect(best.focusPct).toBe(88)
    expect(worst.focusPct).toBe(40)
    expect(best.n).toBe(5)
  })

  it('workspaceFit finds a real per-workspace pattern', () => {
    const office = { id: 'ws1', name: 'Office', revision: 0 }
    const home = { id: 'ws2', name: 'Home', revision: 0 }
    const sessions = [
      ...Array.from({ length: 5 }, () => sessionAt(Date.now(), 85, { workspace: office })),
      ...Array.from({ length: 5 }, () => sessionAt(Date.now(), 40, { workspace: home })),
    ]
    const { best, worst } = workspaceFit(sessions)
    expect(best.label).toBe('Office')
    expect(worst.label).toBe('Home')
  })

  it('workspaceFit ignores sessions with no workspace recorded', () => {
    const sessions = Array.from({ length: 5 }, () => sessionAt(Date.now(), 70))
    expect(workspaceFit(sessions).ranked).toEqual([])
  })

  it('energyFit compares self-reported energy levels', () => {
    const sessions = [
      ...Array.from({ length: 5 }, () => sessionAt(Date.now(), 85, { energyLevel: 'fresh' })),
      ...Array.from({ length: 5 }, () => sessionAt(Date.now(), 40, { energyLevel: 'tired' })),
    ]
    const { best, worst } = energyFit(sessions)
    expect(best.label).toBe('fresh energy')
    expect(worst.label).toBe('tired energy')
  })

  it('driftRecoveryFit compares sessions with and without drift-risk cues', () => {
    const sessions = [
      ...Array.from({ length: 5 }, () => sessionAt(Date.now(), 40, { preDriftEvents: 2 })),
      ...Array.from({ length: 5 }, () => sessionAt(Date.now(), 85, { preDriftEvents: 0 })),
    ]
    const { best, worst } = driftRecoveryFit(sessions)
    expect(best.label).toBe('sessions without drift-risk cues')
    expect(worst.label).toBe('sessions with drift-risk cues')
  })

  it('activityAlignmentFit compares aligned vs drifted activity', () => {
    const aligned = { secondsByKind: { aligned: 100, supportive: 0, off_goal: 0, distraction: 0, unclear: 0, blocked: 0 } }
    const drifted = { secondsByKind: { aligned: 20, supportive: 0, off_goal: 80, distraction: 0, unclear: 0, blocked: 0 } }
    const sessions = [
      ...Array.from({ length: 5 }, () => sessionAt(Date.now(), 85, { activityAlignment: aligned })),
      ...Array.from({ length: 5 }, () => sessionAt(Date.now(), 40, { activityAlignment: drifted })),
    ]
    const { best, worst } = activityAlignmentFit(sessions)
    expect(best.label).toBe('activity mostly matched the goal')
    expect(worst.label).toBe('activity drifted off the goal')
  })

  it('activityAlignmentFit ignores sessions with too little observed activity to mean anything', () => {
    const sparse = { secondsByKind: { aligned: 10, supportive: 0, off_goal: 0, distraction: 0, unclear: 0, blocked: 0 } }
    const sessions = Array.from({ length: 5 }, () => sessionAt(Date.now(), 70, { activityAlignment: sparse }))
    expect(activityAlignmentFit(sessions).ranked).toEqual([])
  })

  it('outputEvidenceFit compares sessions where the watched folder did or did not change', () => {
    const changed = { watched: true, filesChanged: 3, filesCreated: 0, commits: 0 }
    const unchanged = { watched: true, filesChanged: 0, filesCreated: 0, commits: 0 }
    const sessions = [
      ...Array.from({ length: 5 }, () => sessionAt(Date.now(), 85, { outputEvidence: changed })),
      ...Array.from({ length: 5 }, () => sessionAt(Date.now(), 40, { outputEvidence: unchanged })),
    ]
    const { best, worst } = outputEvidenceFit(sessions)
    expect(best.label).toBe('the watched folder changed')
    expect(worst.label).toBe('the watched folder did not change')
  })

  it('outputEvidenceFit excludes sessions where no folder was watched at all', () => {
    const sessions = Array.from({ length: 5 }, () => sessionAt(Date.now(), 70))
    expect(outputEvidenceFit(sessions).ranked).toEqual([])
  })

  it('calibrate() surfaces every new axis by kind and includes qualified ones in insights', () => {
    const office = { id: 'ws1', name: 'Office', revision: 0 }
    const home = { id: 'ws2', name: 'Home', revision: 0 }
    const sessions = [
      ...Array.from({ length: 5 }, () => sessionAt(Date.now(), 85, { workspace: office })),
      ...Array.from({ length: 5 }, () => sessionAt(Date.now(), 40, { workspace: home })),
    ]
    const c = calibrate(sessions)
    expect(c.ready).toBe(true)
    expect(c.workspace.best.label).toBe('Office')
    expect(c.insights.some(i => i.kind === 'workspace')).toBe(true)
  })

  it('outcomeFit works on any subset of sessions, not just calibrate()\'s full usable set', () => {
    const bucket = [
      { goalOutcome: 'yes' }, { goalOutcome: 'yes' }, { goalOutcome: 'no' },
    ]
    expect(outcomeFit(bucket)).toEqual({ n: 3, hitRate: 67 })
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
