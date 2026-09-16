import { FLOW_SCORE } from './attention'
import {
  EYES_OFF_HOLD_SECS,
  FACE_ABSENT_HOLD_MS,
  HEAD_DOWN_HOLD,
  HEAD_DRIFT_THRESH,
  HEAD_TURN_HOLD,
  PHONE_HOLD_MS,
  PROLONGED_CLOSE_MS,
  EARLY_MICROSLEEP_MS,
  YAWN_HOLD_MS,
} from './cameraScoringConstants'

export const SCORE_TRACE_VERSION = 1

export const SCORE_COMPONENT_LABELS = Object.freeze({
  face_present_base: 'Face present base',
  face_transition_decay: 'Brief face-loss decay',
  blink_optimal: 'Optimal blink rate',
  blink_focus_suppression: 'Focused blink suppression',
  blink_normal: 'Normal blink rate',
  blink_extreme: 'Extreme blink rate',
  head_stable: 'Stable head position',
  head_mostly_stable: 'Mostly stable head',
  work_zone_gaze: 'Work-zone gaze',
  productive_downward: 'Productive downward gaze',
  productive_secondary_screen: 'Secondary work screen',
  phone_confirmed: 'Confirmed phone/downward distraction',
  phone_possible: 'Possible phone/downward distraction',
  eyes_closed_prolonged: 'Prolonged eye closure',
  eyes_closed_early: 'Early microsleep signal',
  perclos_high: 'High eye-closure share',
  perclos_elevated: 'Elevated eye-closure share',
  yawn_sustained: 'Sustained yawn',
  looking_up_sustained: 'Sustained upward look',
  head_down_productive_sustained: 'Productive head-down adjustment',
  head_down_sustained: 'Sustained head-down posture',
  head_down_productive_soft: 'Soft productive head-down adjustment',
  head_down_soft: 'Soft head-down posture',
  head_left_sustained: 'Sustained head turn left',
  head_left_soft: 'Soft head turn left',
  head_right_sustained: 'Sustained head turn right',
  head_right_soft: 'Soft head turn right',
  eyes_off_screen: 'Eyes off screen',
  eyes_rolled_up: 'Eyes rolled upward',
  camera_cap: 'Camera-score clamp (0–85)',
  activity_distraction: 'Distracting app/site',
  activity_focus_app: 'Focus app',
  sustained_focus_ramp: 'Sustained-focus ramp',
})

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function contributionRecorder() {
  const components = {}
  return {
    add(id, delta) {
      if (!delta) return
      components[id] = (components[id] || 0) + delta
    },
    components,
  }
}

/**
 * Pure arithmetic core of the live attention score. Stateful hold timers and
 * the sustained-focus ramp stay in SessionScreen; once those conditions have
 * been established, every bonus/penalty is applied here and returned as a
 * compact, versioned trace.
 */
export function calculateBaseAttentionScore(input) {
  const record = contributionRecorder()
  const add = (id, delta) => {
    score += delta
    record.add(id, delta)
  }
  let score = input.hasFace ? 68 : 0
  let primaryReason = 'focused'
  if (input.hasFace) record.add('face_present_base', 68)

  if (input.faceAbsentMs >= FACE_ABSENT_HOLD_MS) {
    score = 0
    primaryReason = 'away'
    record.add('face_absent', 0)
  } else if (input.faceAbsentMs > 0 && input.faceAbsentMs < FACE_ABSENT_HOLD_MS) {
    score = input.previousScore * 0.88
    record.add('face_transition_decay', score - input.previousScore)
  } else if (input.hasFace) {
    if (input.hasBlinkData && input.blinkRate >= 12 && input.blinkRate <= 20) add('blink_optimal', 7)
    else if (input.hasBlinkData && input.blinkRate >= 5 && input.blinkRate < 12) add('blink_focus_suppression', 4)
    else if (input.hasBlinkData && input.blinkRate >= 8 && input.blinkRate <= 28) add('blink_normal', 3)

    if (input.fidgetVariance <= HEAD_DRIFT_THRESH * 0.5) add('head_stable', 5)
    else if (input.fidgetVariance <= HEAD_DRIFT_THRESH) add('head_mostly_stable', 2)

    if (input.pitchDeg >= input.workZonePitchMin && input.pitchDeg < input.workZonePitchMax) add('work_zone_gaze', 5)
    if (input.productiveDownward) add('productive_downward', 3)
    if (input.productiveHorizontal) add('productive_secondary_screen', 5)

    if ((input.phoneMs >= PHONE_HOLD_MS && !input.productiveDownward) || input.distractionDownward) {
      add('phone_confirmed', -45)
      primaryReason = 'phone'
    } else if (input.unknownPhoneDownward) {
      add('phone_possible', -18)
      if (primaryReason === 'focused') primaryReason = 'phone'
    }
    if (input.eyesClosedMs >= PROLONGED_CLOSE_MS) {
      add('eyes_closed_prolonged', -35)
      if (primaryReason === 'focused') primaryReason = 'prolonged'
    } else if (input.earlyMicrosleepMs >= EARLY_MICROSLEEP_MS) {
      add('eyes_closed_early', -15)
      if (primaryReason === 'focused') primaryReason = 'prolonged'
    }
    if (input.hasPerclos) {
      if (input.perclos > 15) add('perclos_high', -30)
      else if (input.perclos > 8) add('perclos_elevated', -15)
    }
    if (input.yawnMs >= YAWN_HOLD_MS) {
      add('yawn_sustained', -20)
      if (primaryReason === 'focused') primaryReason = 'yawn'
    }
    if (input.lookingUpMs >= 3000 && input.pitchUpDT <= 15) {
      add('looking_up_sustained', -25)
      if (primaryReason === 'focused') primaryReason = 'lookingup'
    }
    if (input.hasBlinkData && input.blinkRate > 0 && (input.blinkRate < 3 || input.blinkRate > 35)) {
      add('blink_extreme', -15)
    }
    if (input.pitchDeg >= input.pitchDT && input.headDownSecs >= HEAD_DOWN_HOLD) {
      add(input.productiveDownward ? 'head_down_productive_sustained' : 'head_down_sustained', input.productiveDownward ? -3 : -25)
    } else if (input.pitchDeg >= input.pitchDT * 0.75) {
      add(input.productiveDownward ? 'head_down_productive_soft' : 'head_down_soft', input.productiveDownward ? -1 : -8)
    }
    if (!input.productiveHorizontal) {
      if (input.adjustedYawSigned >= input.yawLT && input.headTurnLeftSecs >= HEAD_TURN_HOLD) add('head_left_sustained', -25)
      else if (input.adjustedYawSigned >= input.yawLT * 0.6) add('head_left_soft', -8)
      if (-input.adjustedYawSigned >= input.yawRT && input.headTurnRightSecs >= HEAD_TURN_HOLD) add('head_right_sustained', -25)
      else if (-input.adjustedYawSigned >= input.yawRT * 0.6) add('head_right_soft', -8)
    }
    if (input.eyesOffSecs >= EYES_OFF_HOLD_SECS) {
      add('eyes_off_screen', -15)
      if (primaryReason === 'focused') primaryReason = 'lookingup'
    }
    if (input.eyesRolledUp) add('eyes_rolled_up', -15)
  }

  const beforeCameraCap = score
  score = clamp(score, 0, 85)
  record.add('camera_cap', score - beforeCameraCap)
  const cameraScore = score

  if (input.hasFace && input.activityPenalty) {
    const before = score
    score = Math.max(0, score - input.activityPenalty)
    record.add('activity_distraction', score - before)
    if (input.activityDistractionMs >= input.activityReasonHoldMs && primaryReason === 'focused') {
      primaryReason = 'distraction_app'
    }
  } else if (input.hasFace && input.activityBonus) {
    const before = score
    score = Math.min(100, score + input.activityBonus)
    record.add('activity_focus_app', score - before)
  }

  return {
    score,
    cameraScore,
    primaryReason,
    components: record.components,
    signals: {
      blinkRate: input.hasBlinkData ? input.blinkRate : null,
      fidgetVariance: input.fidgetVariance,
      pitchDeg: input.pitchDeg,
      yawSigned: input.adjustedYawSigned,
      perclos: input.hasPerclos ? input.perclos : null,
      eyesOffSeconds: input.eyesOffSecs,
      headDownSeconds: input.headDownSecs,
      headTurnLeftSeconds: input.headTurnLeftSecs,
      headTurnRightSeconds: input.headTurnRightSecs,
    },
  }
}

export function finalizeAttentionScore({ base, rampBonus, previousScore, trackingUncertain }) {
  const rawFinal = Math.min(100, base.score + rampBonus)
  const smoothedCandidate = clamp(rawFinal * 0.3 + previousScore * 0.7, 0, 100)
  const finalScore = trackingUncertain ? previousScore : smoothedCandidate
  return {
    score: finalScore,
    rawFinal,
    trace: {
      version: SCORE_TRACE_VERSION,
      components: {
        ...base.components,
        ...(rampBonus ? { sustained_focus_ramp: rampBonus } : {}),
      },
      primaryReason: base.primaryReason,
      cameraScore: base.cameraScore,
      preRampScore: base.score,
      rampBonus,
      rawFinal,
      previousScore,
      smoothedCandidate,
      finalScore,
      heldForUncertainTracking: trackingUncertain === true,
      signals: base.signals,
    },
  }
}

export function shouldBuildSustainedRamp(score) {
  return Number.isFinite(score) && score >= FLOW_SCORE
}
