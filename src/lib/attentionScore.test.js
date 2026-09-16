import { describe, expect, it } from 'vitest'
import { calculateBaseAttentionScore, finalizeAttentionScore, SCORE_TRACE_VERSION } from './attentionScore'

function input(extra = {}) {
  return {
    hasFace: true,
    faceAbsentMs: 0,
    previousScore: 68,
    hasBlinkData: false,
    blinkRate: 0,
    fidgetVariance: 0.02,
    pitchDeg: 10,
    workZonePitchMin: 8,
    workZonePitchMax: 25,
    productiveDownward: false,
    productiveHorizontal: false,
    phoneMs: 0,
    distractionDownward: false,
    unknownPhoneDownward: false,
    eyesClosedMs: 0,
    earlyMicrosleepMs: 0,
    hasPerclos: false,
    perclos: 0,
    yawnMs: 0,
    lookingUpMs: 0,
    pitchUpDT: 15,
    pitchDT: 30,
    headDownSecs: 0,
    adjustedYawSigned: 0,
    yawLT: 30,
    yawRT: 30,
    headTurnLeftSecs: 0,
    headTurnRightSecs: 0,
    eyesOffSecs: 0,
    eyesRolledUp: false,
    activityPenalty: 0,
    activityBonus: 0,
    activityDistractionMs: 0,
    activityReasonHoldMs: 10_000,
    ...extra,
  }
}

describe('pure attention score and trace', () => {
  it('records every applied bonus and penalty with the same arithmetic as the live ruler', () => {
    const base = calculateBaseAttentionScore(input({
      hasBlinkData: true,
      blinkRate: 15,
      fidgetVariance: 0.01,
      productiveHorizontal: true,
      eyesClosedMs: 1600,
      activityBonus: 5,
    }))
    expect(base.components).toMatchObject({
      face_present_base: 68,
      blink_optimal: 7,
      head_stable: 5,
      work_zone_gaze: 5,
      productive_secondary_screen: 5,
      eyes_closed_prolonged: -35,
      activity_focus_app: 5,
    })
    expect(base.score).toBe(60)
    expect(base.primaryReason).toBe('prolonged')
  })

  it('records camera clamping and smoothing rather than hiding either transform', () => {
    const base = calculateBaseAttentionScore(input({ hasBlinkData: true, blinkRate: 15, fidgetVariance: 0.001, productiveHorizontal: true }))
    const final = finalizeAttentionScore({ base, rampBonus: 10, previousScore: 70, trackingUncertain: false })
    expect(base.components.camera_cap).toBe(-5)
    expect(final.rawFinal).toBe(95)
    expect(final.score).toBe(77.5)
    expect(final.trace.version).toBe(SCORE_TRACE_VERSION)
  })

  it('holds the trusted score when tracking is uncertain and records that refusal', () => {
    const base = calculateBaseAttentionScore(input({ eyesClosedMs: 1600 }))
    const final = finalizeAttentionScore({ base, rampBonus: 0, previousScore: 72, trackingUncertain: true })
    expect(final.score).toBe(72)
    expect(final.trace.heldForUncertainTracking).toBe(true)
  })

  it('records brief face loss as decay from the previous score, not as a new bonus', () => {
    const base = calculateBaseAttentionScore(input({ hasFace: false, faceAbsentMs: 400, previousScore: 80 }))
    expect(base.score).toBe(70.4)
    expect(Object.keys(base.components)).toEqual(['face_transition_decay'])
    expect(base.components.face_transition_decay).toBeCloseTo(-9.6)
  })
})
