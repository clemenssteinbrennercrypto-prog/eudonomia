import { describe, it, expect } from 'vitest'
import { analyzeSession, MIN_SESSION_SECONDS_FOR_CONCLUSION, SESSION_ANALYSIS_VERSION } from './sessionAnalysis'
import { ATTENTION_SCORING_VERSION } from './focusMetric'

// A session record shaped the way App.jsx actually merges and saves one:
// SessionScreen's onEnd payload plus task/goal/tags/workspace, post
// withSessionFocusMetric. `pct` picks focusedSeconds so sessionFocusPct comes
// out to exactly that number.
function session({ actualSeconds = 1000, pct = 70, goalOutcome, extra = {} } = {}) {
  return {
    id: 'sess-1',
    timestamp: Date.now(),
    actualSeconds,
    measuredSeconds: actualSeconds,
    focusedSeconds: Math.round(actualSeconds * (pct / 100)),
    avgFocusScore: pct,
    scoreMeasured: true,
    attentionScoringVersion: ATTENTION_SCORING_VERSION,
    attentionAccumulationVersion: 2,
    plannedDuration: 30,
    goal: 'Draft the intro chapter',
    task: 'Thesis',
    energyLevel: 'medium',
    goalOutcome: goalOutcome ?? null,
    timeline: [],
    distractionLog: [],
    focusPhases: { seconds: {}, dominant: null },
    activityAlignment: null,
    outputEvidence: null,
    workspace: null,
    preDriftEvents: 0,
    preDriftSeconds: 0,
    distractionEvents: 0,
    ...extra,
  }
}

const usablePriorSession = () => session({ actualSeconds: 600, pct: 70 })

describe('status transitions', () => {
  it('awaits an outcome even with rich measurement data', () => {
    const a = analyzeSession(session({ actualSeconds: 1800, pct: 85 }))
    expect(a.status).toBe('awaiting_outcome')
    expect(a.conclusion).toBeNull()
    expect(a.nextAction).toBeNull()
    // Facts are still computed so Measured Facts can render immediately.
    expect(a.measurement.aboveThresholdPct).toBe(85)
  })

  it('stays facts_only below the conclusion floor even once an outcome is given', () => {
    const a = analyzeSession(session({ actualSeconds: MIN_SESSION_SECONDS_FOR_CONCLUSION - 1, pct: 90, goalOutcome: 'yes' }))
    expect(a.status).toBe('facts_only')
    expect(a.conclusion).toBeNull()
    expect(a.nextAction).toBeNull()
    expect(a.goalOutcome).toBe('yes')
  })

  it('becomes ready once both a long-enough duration and an outcome are present', () => {
    const withoutOutcome = analyzeSession(session({ actualSeconds: 1800, pct: 70 }))
    expect(withoutOutcome.status).toBe('awaiting_outcome')

    const withOutcome = analyzeSession(session({ actualSeconds: 1800, pct: 70, goalOutcome: 'yes' }))
    expect(withOutcome.status).toBe('ready')
    expect(withOutcome.conclusion).not.toBeNull()
    expect(withOutcome.nextAction).not.toBeNull()
  })

  it('normalizes a legacy goalAchieved boolean into goalOutcome', () => {
    const a = analyzeSession(session({ actualSeconds: 1800, pct: 70, extra: { goalOutcome: null, goalAchieved: true } }))
    expect(a.status).toBe('ready')
    expect(a.goalOutcome).toBe('yes')
  })

  it('carries version and status on every result', () => {
    const a = analyzeSession(session({ goalOutcome: 'yes' }))
    expect(a.version).toBe(SESSION_ANALYSIS_VERSION)
  })
})

describe('conclusion codes — the band × outcome matrix', () => {
  const cases = [
    { pct: 85, outcome: 'no', code: 'HIGH_FOCUS_GOAL_MISSED' },
    { pct: 85, outcome: 'partly', code: 'HIGH_FOCUS_PARTIAL' },
    { pct: 85, outcome: 'yes', code: 'HIGH_FOCUS_GOAL_MET' },
    { pct: 30, outcome: 'yes', code: 'LOW_FOCUS_GOAL_MET' },
    { pct: 30, outcome: 'no', code: 'LOW_FOCUS_GOAL_MISSED' },
    { pct: 30, outcome: 'partly', code: 'LOW_FOCUS_PARTIAL' },
    { pct: 60, outcome: 'yes', code: 'MIXED_FOCUS_GOAL_MET' },
    { pct: 60, outcome: 'partly', code: 'MIXED_FOCUS_PARTIAL' },
    { pct: 60, outcome: 'no', code: 'MIXED_FOCUS_GOAL_MISSED' },
  ]

  for (const { pct, outcome, code } of cases) {
    it(`${pct}% focus + outcome "${outcome}" -> ${code}`, () => {
      const a = analyzeSession(session({ actualSeconds: 1800, pct, goalOutcome: outcome }))
      expect(a.conclusion.code).toBe(code)
      expect(a.conclusion.evidence).toMatchObject({ focusPct: pct, outcome })
    })
  }
})

describe('measurement refusals', () => {
  it('NOT_MEASURED when focus was never scored, and never carries a focus number', () => {
    const a = analyzeSession(session({
      actualSeconds: 1800,
      goalOutcome: 'yes',
      extra: { scoreMeasured: false },
    }))
    expect(a.measurement.scored).toBe(false)
    expect(a.conclusion.code).toBe('NOT_MEASURED')
    expect(a.conclusion.evidence).not.toHaveProperty('focusPct')
  })

  it('SCORING_VERSION_INCOMPATIBLE blocks a focus-based conclusion even with clean numbers', () => {
    const a = analyzeSession(session({
      actualSeconds: 1800,
      pct: 90,
      goalOutcome: 'yes',
      extra: { attentionScoringVersion: 0 },
    }))
    expect(a.measurement.scored).toBe(true)
    expect(a.measurement.compatible).toBe(false)
    expect(a.conclusion.code).toBe('SCORING_VERSION_INCOMPATIBLE')
    expect(a.conclusion.evidence).not.toHaveProperty('focusPct')
  })

  it('a completed outcome still gets a next action even when attention is not measured', () => {
    const a = analyzeSession(session({
      actualSeconds: 1800,
      goalOutcome: 'yes',
      extra: { scoreMeasured: false },
    }))
    expect(a.nextAction).not.toBeNull()
  })
})

describe('next action — exactly one, priority ordered', () => {
  it('returns exactly one action even when several situational conditions match', () => {
    // Deliberately trips RUN_LONGER_NEXT_TIME (actualSeconds < 180), heavy
    // activity drift, AND a long unstable arrival — all at once. Priority
    // order must pick the first check, not collect several.
    const a = analyzeSession(session({
      actualSeconds: 150,
      pct: 60, // mixed band -> falls through to situational checks
      goalOutcome: 'yes',
      extra: {
        measuredSeconds: 150,
        focusedSeconds: 90,
        activityAlignment: {
          secondsByKind: { aligned: 50, off_goal: 50, supportive: 0, unclear: 0, distraction: 0, blocked: 0 },
          byActivity: {},
          events: [],
        },
        focusPhases: { seconds: { arrival: 130, ramp: 10 }, dominant: 'arrival' },
        preDriftEvents: 3,
        preDriftSeconds: 60,
      },
    }))
    expect(a.nextAction.code).toBe('RUN_LONGER_NEXT_TIME')
  })

  it('falls back to the generic outcome action when nothing situational stands out', () => {
    const a = analyzeSession(session({ actualSeconds: 1800, pct: 60, goalOutcome: 'partly' }))
    expect(a.nextAction.code).toBe('MAKE_CRITERION_SMALLER_AND_OBSERVABLE')
  })

  it('uses the ultimate fallback only when there is no outcome-derived action either', () => {
    // facts_only sessions never reach buildNextAction at all — nextAction is
    // null by construction. This asserts the invariant directly.
    const a = analyzeSession(session({ actualSeconds: MIN_SESSION_SECONDS_FOR_CONCLUSION - 1, pct: 60, goalOutcome: 'yes' }))
    expect(a.nextAction).toBeNull()
  })
})

describe('baseline qualification', () => {
  it('passes through calibration.calibrate() unmodified', () => {
    const a = analyzeSession(session({ goalOutcome: 'yes' }), { priorSessions: [] })
    expect(a.baseline).toEqual({ sessionsAnalysed: 0, ready: false, needMore: 8 })
  })

  it('reports ready once enough prior sessions qualify', () => {
    const priors = Array.from({ length: 8 }, usablePriorSession)
    const a = analyzeSession(session({ goalOutcome: 'yes' }), { priorSessions: priors })
    expect(a.baseline.ready).toBe(true)
    expect(a.baseline.sessionsAnalysed).toBe(8)
  })
})

describe('facts — always computed, never fabricated', () => {
  it('does not fabricate an activity breakdown from sparse activity data', () => {
    const a = analyzeSession(session({
      actualSeconds: 1800,
      goalOutcome: 'yes',
      extra: {
        activityAlignment: {
          secondsByKind: { aligned: 20, supportive: 10, off_goal: 0, unclear: 0, distraction: 0, blocked: 0 },
          byActivity: {},
          events: [],
        },
      },
    }))
    expect(a.facts.activity).toBeNull()
  })

  it('includes an activity breakdown once enough activity was observed', () => {
    const a = analyzeSession(session({
      actualSeconds: 1800,
      goalOutcome: 'yes',
      extra: {
        activityAlignment: {
          secondsByKind: { aligned: 100, supportive: 20, off_goal: 0, unclear: 0, distraction: 0, blocked: 0 },
          byActivity: {},
          events: [],
        },
      },
    }))
    expect(a.facts.activity).not.toBeNull()
    expect(a.facts.activity.observedSeconds).toBe(120)
  })

  it('always computes duration and coverage facts regardless of status', () => {
    const a = analyzeSession(session({ actualSeconds: 1800, pct: 70 }))
    expect(a.status).toBe('awaiting_outcome')
    expect(a.facts.duration.actualSeconds).toBe(1800)
    expect(a.facts.coverage.coveragePct).toBe(100)
  })
})
