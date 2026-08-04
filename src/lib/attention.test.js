import { describe, it, expect } from 'vitest'
import {
  CALIBRATION_SECS,
  LOCK_IN_STREAK_SECS,
  RAMP_STREAK_SECS,
  RECOVERY_WINDOW_MS,
  analyzeFrame,
  classifyFocusPhase,
  classifyHorizontalAttention,
  computeThresholds,
  getCircadianFactor,
  headVariance,
  irisHorizontalGaze,
  mouthAspectRatio,
} from './attention'

// These tests exist because each of them is a bug that actually shipped, or an
// invariant from CLAUDE.md that was previously only prose. They are here to stop
// the same class of regression coming back while several people edit this logic.

// ── Helpers ──────────────────────────────────────────────────────────────────
// Minimal synthetic FaceMesh landmark set. Only the indices the maths reads are
// filled in; everything else stays at the neutral centre.
function makeLandmarks({ noseX = 0.5, irisShift = 0, mouthOpen = 0.02 } = {}) {
  const lms = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  const set = (i, x, y) => { lms[i] = { x, y, z: 0 } }

  set(1, noseX, 0.50)    // NOSE_TIP
  set(10, 0.5, 0.20)     // FOREHEAD
  set(152, 0.5, 0.80)    // CHIN

  // eye corners: right eye around x=0.40, left eye around x=0.60
  set(33, 0.35, 0.45); set(133, 0.45, 0.45)   // right outer / inner
  set(263, 0.65, 0.45); set(362, 0.55, 0.45)  // left outer / inner
  // eyelids (open eye)
  set(160, 0.40, 0.43); set(144, 0.40, 0.47)
  set(158, 0.42, 0.43); set(153, 0.42, 0.47)
  set(387, 0.60, 0.43); set(373, 0.60, 0.47)
  set(385, 0.58, 0.43); set(380, 0.58, 0.47)
  // iris centres, shifted by irisShift (fraction of eye width, 0.10 wide)
  set(468, 0.40 + irisShift * 0.10, 0.45)
  set(473, 0.60 + irisShift * 0.10, 0.45)
  // mouth
  set(61, 0.45, 0.68); set(291, 0.55, 0.68)
  set(13, 0.50, 0.68 - mouthOpen); set(14, 0.50, 0.68 + mouthOpen)
  set(312, 0.51, 0.68 - mouthOpen); set(317, 0.51, 0.68 + mouthOpen)
  return lms
}

// A monitor normalizes to the 'primary_screen' role; an explicit role like
// 'screen' is NOT valid and would be silently ignored by isScreenRole.
const screenAt = (col) => [{ type: 'monitor', col, row: 0.4 }]

// ── Sign conventions (the yaw inversion bug) ─────────────────────────────────
describe('yaw / iris sign conventions', () => {
  it('yawSigned is positive when the head turns to the user\'s left', () => {
    // The camera image is mirrored, so a turn to the user's left moves the nose
    // to the +x side of the eye midpoint. Everything downstream depends on this.
    const left = analyzeFrame(makeLandmarks({ noseX: 0.56 }))
    const right = analyzeFrame(makeLandmarks({ noseX: 0.44 }))
    expect(left.yawSigned).toBeGreaterThan(0)
    expect(right.yawSigned).toBeLessThan(0)
  })

  it('pairs a left head turn with a LEFT screen, not a right one', () => {
    // The shipped bug: positive yaw was paired with hasRightScreen, so "looking
    // left" read as "productively facing the right monitor" — which skipped the
    // head-turn penalty AND handed out a +5 bonus for looking away.
    expect(classifyHorizontalAttention(screenAt(0.2), 40).kind).toBe('productive_left')
    expect(classifyHorizontalAttention(screenAt(0.8), -40).kind).toBe('productive_right')
  })

  it('does not call a turn productive when the screen is on the other side', () => {
    expect(classifyHorizontalAttention(screenAt(0.8), 40).kind).toBe('unknown_horizontal')
    expect(classifyHorizontalAttention(screenAt(0.2), -40).kind).toBe('unknown_horizontal')
  })

  it('treats a small turn as centred', () => {
    expect(classifyHorizontalAttention(screenAt(0.2), 5).kind).toBe('center')
  })

  it('irisHorizontalGaze is ~0 when looking straight and signed when shifted', () => {
    expect(Math.abs(irisHorizontalGaze(makeLandmarks()))).toBeLessThan(0.01)
    // iris+ = eyes toward the user's RIGHT — the OPPOSITE convention to yaw.
    // Scoring's "eyes off the monitor you're facing" check relies on that.
    expect(irisHorizontalGaze(makeLandmarks({ irisShift: 1 }))).toBeGreaterThan(0)
    expect(irisHorizontalGaze(makeLandmarks({ irisShift: -1 }))).toBeLessThan(0)
  })
})

// ── Circadian (CLAUDE.md invariant #1) ───────────────────────────────────────
describe('getCircadianFactor', () => {
  const at = (h) => getCircadianFactor(new Date(2026, 0, 15, h, 0, 0))

  it('is below 1 during tired hours and exactly 1 otherwise', () => {
    expect(at(2)).toBeLessThan(1)    // night
    expect(at(23)).toBeLessThan(1)   // night
    expect(at(14)).toBeLessThan(1)   // post-lunch dip
    expect(at(10)).toBe(1)
    expect(at(19)).toBe(1)
  })

  it('makes the alert fire SOONER when multiplied (never divided)', () => {
    // The regression that keeps coming back: `delay / factor` makes a tired user
    // wait LONGER, which is backwards. Multiplication must shorten the delay.
    const delay = 90_000
    expect(delay * at(2)).toBeLessThan(delay)
    expect(delay / at(2)).toBeGreaterThan(delay) // documents the wrong direction
  })
})

// ── Focus phases (the "stuck on Arrival" bug) ────────────────────────────────
describe('classifyFocusPhase', () => {
  const base = {
    elapsedSecs: 300,
    score: 68,
    goodStreakSecs: 0,
    msSinceDistraction: Infinity,
    preDriftActive: false,
    inFlow: false,
  }

  it('progresses past Arrival at a score that just clears the focus threshold', () => {
    // The shipped bug: phases were gated on the score's ramp accumulator, which
    // only grows above a RAW score of 72 and decays 3x faster. At the resting
    // base of 68 it never left 0, so every session showed "Arrival" forever.
    // A resting score of 68 must reach Ramp and then Lock-in purely on streak.
    const early = { ...base, elapsedSecs: CALIBRATION_SECS + 5 }
    expect(classifyFocusPhase({ ...early, goodStreakSecs: 1 })).toBe('arrival')
    expect(classifyFocusPhase({ ...early, goodStreakSecs: RAMP_STREAK_SECS })).toBe('ramp')
    expect(classifyFocusPhase({ ...early, goodStreakSecs: LOCK_IN_STREAK_SECS })).toBe('lock_in')
  })

  it('does not fall back to Arrival late in a session at a good score', () => {
    // elapsedSecs is past the arrival window here, so a healthy score means the
    // user is at least ramping — never "just arrived" 5 minutes in.
    expect(classifyFocusPhase({ ...base, elapsedSecs: 300, goodStreakSecs: 0 })).toBe('ramp')
  })

  it('every phase is reachable', () => {
    const reached = new Set([
      classifyFocusPhase({ ...base, score: 30 }),
      classifyFocusPhase({ ...base, msSinceDistraction: RECOVERY_WINDOW_MS - 1 }),
      classifyFocusPhase({ ...base, score: 60 }),
      classifyFocusPhase({ ...base, elapsedSecs: 10, goodStreakSecs: 0 }),
      classifyFocusPhase({ ...base, goodStreakSecs: RAMP_STREAK_SECS }),
      classifyFocusPhase({ ...base, inFlow: true }),
    ])
    expect([...reached].sort()).toEqual(
      ['arrival', 'drift', 'fade', 'lock_in', 'ramp', 'recovery']
    )
  })

  it('ranks drift and recovery above the positive phases', () => {
    // A long good streak must not mask an active problem.
    expect(classifyFocusPhase({ ...base, score: 20, goodStreakSecs: 999 })).toBe('drift')
    expect(classifyFocusPhase({ ...base, goodStreakSecs: 999, msSinceDistraction: 1000 }))
      .toBe('recovery')
  })

  it('shows Arrival early in a session before any streak exists', () => {
    expect(classifyFocusPhase({ ...base, elapsedSecs: CALIBRATION_SECS + 1 })).toBe('arrival')
  })

  it('treats pre-drift risk as Fade', () => {
    expect(classifyFocusPhase({ ...base, preDriftActive: true })).toBe('fade')
  })
})

// ── Workspace thresholds ─────────────────────────────────────────────────────
describe('computeThresholds', () => {
  it('widens the yaw tolerance on the side a screen actually sits', () => {
    const left = computeThresholds(screenAt(0.2))
    expect(left.yawLeft).toBeGreaterThan(left.yawRight)
    const right = computeThresholds(screenAt(0.8))
    expect(right.yawRight).toBeGreaterThan(right.yawLeft)
  })

  it('is symmetric with no devices configured', () => {
    const t = computeThresholds([])
    expect(t.yawLeft).toBe(t.yawRight)
    expect(t.workZonePitchMax).toBeGreaterThan(t.workZonePitchMin)
  })

  it('keeps the work zone ordered for every layout', () => {
    for (const devices of [[], screenAt(0.2), screenAt(0.8), [{ type: 'laptop', row: 0.3, col: 0.5 }]]) {
      const t = computeThresholds(devices)
      expect(t.workZonePitchMax).toBeGreaterThan(t.workZonePitchMin)
    }
  })
})

// ── Frame maths ──────────────────────────────────────────────────────────────
describe('analyzeFrame', () => {
  it('reports a neutral pose for a centred face', () => {
    const f = analyzeFrame(makeLandmarks())
    expect(Math.abs(f.yawSigned)).toBeLessThan(1)
    expect(f.avgEar).toBeGreaterThan(0)
    expect(Number.isFinite(f.pitchDeg)).toBe(true)
  })

  it('returns finite numbers for every field', () => {
    const f = analyzeFrame(makeLandmarks({ noseX: 0.58, irisShift: 0.8 }))
    for (const [k, v] of Object.entries(f)) {
      if (k === 'nosePt') continue
      expect(Number.isFinite(v), `${k} should be finite`).toBe(true)
    }
  })

  it('detects an open mouth as a higher aspect ratio', () => {
    expect(mouthAspectRatio(makeLandmarks({ mouthOpen: 0.06 })))
      .toBeGreaterThan(mouthAspectRatio(makeLandmarks({ mouthOpen: 0.01 })))
  })
})

describe('headVariance', () => {
  it('is zero for a still head and grows as it moves', () => {
    const still = [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }]
    const moving = [{ x: 0.3, y: 0.4 }, { x: 0.5, y: 0.6 }, { x: 0.7, y: 0.4 }]
    expect(headVariance(still)).toBe(0)
    expect(headVariance(moving)).toBeGreaterThan(headVariance(still))
  })

  it('returns 0 rather than NaN without enough history', () => {
    expect(headVariance([])).toBe(0)
    expect(headVariance([{ x: 0.5, y: 0.5 }])).toBe(0)
  })
})
