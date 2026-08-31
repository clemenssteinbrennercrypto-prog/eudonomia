import {
  CALIBRATION_SECS,
  PHONE_PITCH_THRESH,
  RECOVERY_WINDOW_MS,
  analyzeFrame,
  classifyCalibratedWorkspace,
  classifyDownwardAttention,
  classifyHorizontalAttention,
  computeThresholds,
  headVariance,
} from './attention.js'
import {
  BLINK_WIN_MS,
  CONF_UNCERTAIN_MAX,
  DISTRACTION_DOWN_HOLD_MS,
  EARLY_MICROSLEEP_MS,
  EAR_PROLONGED_CLOSE,
  EAR_RECALIB_INTERVAL,
  EYES_OFF_HOLD_SECS,
  FACE_ABSENT_HOLD_MS,
  HEAD_DOWN_HOLD,
  HEAD_DRIFT_THRESH,
  HEAD_DRIFT_WIN_MS,
  HEAD_TURN_HOLD,
  IRIS_OFF_H,
  MAR_YAWN,
  PERCLOS_WIN_MS,
  PHONE_HOLD_MS,
  PROLONGED_CLOSE_MS,
  UNCERTAIN_HOLD_MS,
  YAWN_HOLD_MS,
} from './cameraScoringConstants.js'
// Historical FaceMesh.js sampling cadence used by the recorded parity corpus.
// Keep it explicit here: the live WebView camera controller no longer exists.
export const PARITY_FRAME_INTERVAL_MS = 67

// Replays the camera-only live scoring configuration: no activity bonus or
// penalty, but the same calibration, rolling windows, holds, trust gate,
// smoothing and sustained-focus ramp as SessionScreen.handleFaceResults.
// Both engines pass through this one scorer, so a native-source delta cannot be
// hidden by two independently maintained implementations.
export function replayCameraScores(records, options = {}) {
  const replay = createCameraScoreReplay(options)
  return records.map((record, frameIndex) => replay.step(record, frameIndex))
}

export function createCameraScoreReplay({
  devices = [],
  workspace = null,
  frameIntervalMs = PARITY_FRAME_INTERVAL_MS,
} = {}) {
  const {
    yawLeft: yawLT,
    yawRight: yawRT,
    yawNeutral,
    pitchDown: pitchDT,
    pitchUp: pitchUpDT,
    workZonePitchMin,
    workZonePitchMax,
  } = computeThresholds(devices)
  const startAt = 1_700_000_000_000
  const state = {
    blinkTimestamps: [],
    wasClosed: false,
    perclosHistory: [],
    noseHistory: [],
    headDownFrames: 0,
    headTurnLeftFrames: 0,
    headTurnRightFrames: 0,
    eyesOffFrames: 0,
    headDownStart: null,
    headTurnLeftStart: null,
    headTurnRightStart: null,
    eyesOffStart: null,
    eyesClosedSince: null,
    yawnStart: null,
    phoneStart: null,
    distractionDownStart: null,
    lookingUpStart: null,
    faceAbsentSince: null,
    lowConfidenceSince: null,
    earBaseline: 0.28,
    earCalibration: [],
    irisCalibration: [],
    workspaceCalibration: [],
    irisHNeutral: 0,
    irisVNeutral: 0,
    workspaceNeutral: { yawSigned: 0, pitchDeg: 0, irisH: 0 },
    lastRecalibrationAt: 0,
    focusScore: 68,
    sustainedGoodMs: 0,
    lastFrameAt: 0,
    lastDistractionAt: 0,
  }

  return {
    step(record, frameIndex) {
      if (record.frameMeasured === false) return null

      const now = startAt + frameIndex * frameIntervalMs
      const sessionElapsed = (now - startAt) / 1000
      const calibrating = sessionElapsed < CALIBRATION_SECS
      const landmarks = Array.isArray(record.landmarks) ? record.landmarks : null
      const hasFace = Boolean(landmarks?.length)

      if (!hasFace) {
        if (!state.faceAbsentSince) state.faceAbsentSince = now
      } else {
        state.faceAbsentSince = null
      }
      const faceAbsentMs = state.faceAbsentSince ? now - state.faceAbsentSince : 0

      let avgEar = 0.30
      let pitchDeg = 0
      let pitchUpDeg = 0
      let yawSigned = 0
      let mar = 0
      let irisV = 0
      let irisH = 0

      if (hasFace) {
        const signals = analyzeFrame(landmarks)
        avgEar = signals.avgEar
        pitchDeg = signals.pitchDeg
        pitchUpDeg = signals.pitchUpDeg
        yawSigned = signals.yawSigned
        mar = signals.mar
        irisV = signals.irisV
        irisH = signals.irisH

        const earBlink = state.earBaseline * 0.72
        const earHeavy = state.earBaseline * 0.55
        if (avgEar < earBlink) {
          state.wasClosed = true
        } else if (state.wasClosed) {
          state.wasClosed = false
          state.blinkTimestamps.push(now)
        }
        state.perclosHistory.push({ t: now, heavy: avgEar < earHeavy })
        state.noseHistory.push({ t: now, x: signals.nosePt.x, y: signals.nosePt.y })
      }

      const adjustedYawSigned = yawSigned - yawNeutral
      state.blinkTimestamps = state.blinkTimestamps.filter(time => time > now - BLINK_WIN_MS)
      state.perclosHistory = state.perclosHistory.filter(frame => frame.t > now - PERCLOS_WIN_MS)
      state.noseHistory = state.noseHistory.filter(point => point.t > now - HEAD_DRIFT_WIN_MS)

      const blinkRate = state.blinkTimestamps.length * 3
      const hasBlinkData = sessionElapsed >= 15
      const perclos = state.perclosHistory.length
        ? state.perclosHistory.filter(frame => frame.heavy).length / state.perclosHistory.length * 100
        : 0
      const hasPerclos = sessionElapsed >= 30 && state.perclosHistory.length >= 15

      if (hasFace && avgEar < EAR_PROLONGED_CLOSE) {
        if (!state.eyesClosedSince) state.eyesClosedSince = now
      } else {
        state.eyesClosedSince = null
      }
      const eyesClosedMs = state.eyesClosedSince ? now - state.eyesClosedSince : 0
      const earlyMicrosleepMs = hasFace && avgEar < EAR_PROLONGED_CLOSE ? eyesClosedMs : 0

      if (hasFace && mar > MAR_YAWN) {
        if (!state.yawnStart) state.yawnStart = now
      } else {
        state.yawnStart = null
      }
      const yawnMs = state.yawnStart ? now - state.yawnStart : 0

      if (hasFace && pitchDeg >= PHONE_PITCH_THRESH) {
        if (!state.phoneStart) state.phoneStart = now
      } else {
        state.phoneStart = null
      }
      const phoneMs = state.phoneStart ? now - state.phoneStart : 0

      if (hasFace && pitchUpDeg >= pitchUpDT) {
        if (!state.lookingUpStart) state.lookingUpStart = now
      } else {
        state.lookingUpStart = null
      }
      const lookingUpMs = state.lookingUpStart ? now - state.lookingUpStart : 0

      if (hasFace && pitchDeg >= pitchDT && pitchDeg < PHONE_PITCH_THRESH) {
        state.headDownFrames += 1
      } else {
        state.headDownFrames = 0
        state.headDownStart = null
      }
      if (hasFace && adjustedYawSigned >= yawLT) {
        state.headTurnLeftFrames += 1
      } else {
        state.headTurnLeftFrames = 0
        state.headTurnLeftStart = null
      }
      if (hasFace && -adjustedYawSigned >= yawRT) {
        state.headTurnRightFrames += 1
      } else {
        state.headTurnRightFrames = 0
        state.headTurnRightStart = null
      }

      let headDownSecs = 0
      if (state.headDownFrames >= 3) {
        if (!state.headDownStart) state.headDownStart = now
        headDownSecs = (now - state.headDownStart) / 1000
      }
      let headTurnLeftSecs = 0
      if (state.headTurnLeftFrames >= 3) {
        if (!state.headTurnLeftStart) state.headTurnLeftStart = now
        headTurnLeftSecs = (now - state.headTurnLeftStart) / 1000
      }
      let headTurnRightSecs = 0
      if (state.headTurnRightFrames >= 3) {
        if (!state.headTurnRightStart) state.headTurnRightStart = now
        headTurnRightSecs = (now - state.headTurnRightStart) / 1000
      }

      const fidgetVariance = headVariance(state.noseHistory)
      let confidence = 0
      if (hasFace) {
        confidence += 0.5
        if (avgEar >= 0.15 && avgEar <= 0.45) confidence += 0.3
        if (fidgetVariance <= HEAD_DRIFT_THRESH) confidence += 0.2
      }
      if (hasFace && !calibrating && confidence <= CONF_UNCERTAIN_MAX) {
        if (!state.lowConfidenceSince) state.lowConfidenceSince = now
      } else {
        state.lowConfidenceSince = null
      }
      const trackingUncertain = Boolean(state.lowConfidenceSince) &&
        now - state.lowConfidenceSince >= UNCERTAIN_HOLD_MS

      const eyesRolledUp = hasFace && irisV > 0.25
      const calibratedTarget = hasFace && !calibrating
        ? classifyCalibratedWorkspace(
            workspace,
            { yawSigned, pitchDeg: pitchDeg - pitchUpDeg, irisH },
            state.workspaceNeutral,
          )
        : null
      const calibratedRole = calibratedTarget?.role
      const calibratedDownward = calibratedRole === 'reference_material' ||
        calibratedRole === 'writing_surface' || calibratedRole === 'input_area'
      const calibratedDistraction = calibratedRole === 'distraction_device' ||
        calibratedTarget?.object?.type === 'phone'
      const downwardContext = calibratedDistraction
        ? { kind: 'distraction', object: calibratedTarget.object, role: calibratedRole }
        : calibratedDownward
          ? { kind: 'productive', object: calibratedTarget.object, role: calibratedRole }
          : hasFace
            ? classifyDownwardAttention(devices, pitchDeg, adjustedYawSigned)
            : { kind: 'none' }
      const calibratedScreen = calibratedRole === 'primary_screen' || calibratedRole === 'secondary_screen'
      const calibratedCol = calibratedTarget?.object?.col ?? 0.5
      const horizontalContext = calibratedScreen && calibratedRole === 'secondary_screen'
        ? { kind: calibratedCol < 0.5 ? 'productive_left' : 'productive_right' }
        : calibratedScreen
          ? { kind: 'center' }
          : hasFace
            ? classifyHorizontalAttention(devices, adjustedYawSigned)
            : { kind: 'center' }
      const productiveDownward = downwardContext.kind === 'productive'
      const unknownPhoneDownward = downwardContext.kind === 'unknown_phone'
      const productiveHorizontal = horizontalContext.kind === 'productive_left' ||
        horizontalContext.kind === 'productive_right'

      const adjustedIrisH = hasFace ? irisH - state.irisHNeutral : 0
      let eyesOffScreen = false
      if (hasFace) {
        eyesOffScreen = productiveHorizontal
          ? adjustedIrisH * adjustedYawSigned > 0 && Math.abs(adjustedIrisH) >= IRIS_OFF_H
          : Math.abs(adjustedIrisH) >= IRIS_OFF_H
      }
      if (eyesOffScreen) {
        state.eyesOffFrames += 1
      } else {
        state.eyesOffFrames = 0
        state.eyesOffStart = null
      }
      let eyesOffSecs = 0
      if (state.eyesOffFrames >= 3) {
        if (!state.eyesOffStart) state.eyesOffStart = now
        eyesOffSecs = (now - state.eyesOffStart) / 1000
      }

      if (downwardContext.kind === 'distraction') {
        if (!state.distractionDownStart) state.distractionDownStart = now
      } else {
        state.distractionDownStart = null
      }
      const distractionDownward = state.distractionDownStart
        ? now - state.distractionDownStart >= DISTRACTION_DOWN_HOLD_MS
        : false

      if (calibrating) {
        if (hasFace && avgEar > 0.20) {
          state.earCalibration.push(avgEar)
          state.irisCalibration.push({ h: irisH, v: irisV })
          state.workspaceCalibration.push({ yawSigned, pitchDeg: pitchDeg - pitchUpDeg, irisH })
        }
        if (state.earCalibration.length) {
          state.earBaseline = mean(state.earCalibration)
        }
        if (state.irisCalibration.length) {
          state.irisHNeutral = mean(state.irisCalibration.map(sample => sample.h))
          state.irisVNeutral = mean(state.irisCalibration.map(sample => sample.v))
        }
        if (state.workspaceCalibration.length) {
          state.workspaceNeutral = {
            yawSigned: mean(state.workspaceCalibration.map(sample => sample.yawSigned)),
            pitchDeg: mean(state.workspaceCalibration.map(sample => sample.pitchDeg)),
            irisH: mean(state.workspaceCalibration.map(sample => sample.irisH)),
          }
        }
        state.focusScore = 68
        return state.focusScore
      }

      if (hasFace && avgEar > 0.20 && now - state.lastRecalibrationAt >= EAR_RECALIB_INTERVAL) {
        state.earBaseline = state.earBaseline * 0.8 + avgEar * 0.2
        state.lastRecalibrationAt = now
      }

      const frameDelta = state.lastFrameAt ? Math.min(200, now - state.lastFrameAt) : 33
      state.lastFrameAt = now
      let score = hasFace ? 68 : 0

      if (faceAbsentMs >= FACE_ABSENT_HOLD_MS) {
        score = 0
        state.sustainedGoodMs = 0
      } else if (faceAbsentMs > 0) {
        score = state.focusScore * 0.88
      } else if (hasFace) {
        if (hasBlinkData && blinkRate >= 12 && blinkRate <= 20) score += 7
        else if (hasBlinkData && blinkRate >= 5 && blinkRate < 12) score += 4
        else if (hasBlinkData && blinkRate >= 8 && blinkRate <= 28) score += 3

        if (fidgetVariance <= HEAD_DRIFT_THRESH * 0.5) score += 5
        else if (fidgetVariance <= HEAD_DRIFT_THRESH) score += 2
        if (pitchDeg >= workZonePitchMin && pitchDeg < workZonePitchMax) score += 5
        if (productiveDownward) score += 3
        if (productiveHorizontal) score += 5

        if ((phoneMs >= PHONE_HOLD_MS && !productiveDownward) || distractionDownward) score -= 45
        else if (unknownPhoneDownward) score -= 18
        if (eyesClosedMs >= PROLONGED_CLOSE_MS) score -= 35
        else if (earlyMicrosleepMs >= EARLY_MICROSLEEP_MS) score -= 15
        if (hasPerclos) {
          if (perclos > 15) score -= 30
          else if (perclos > 8) score -= 15
        }
        if (yawnMs >= YAWN_HOLD_MS) score -= 20
        if (lookingUpMs >= 3000 && pitchUpDT <= 15) score -= 25
        if (hasBlinkData && blinkRate > 0 && (blinkRate < 3 || blinkRate > 35)) score -= 15
        if (pitchDeg >= pitchDT && headDownSecs >= HEAD_DOWN_HOLD) {
          score -= productiveDownward ? 3 : 25
        } else if (pitchDeg >= pitchDT * 0.75) {
          score -= productiveDownward ? 1 : 8
        }
        if (!productiveHorizontal) {
          if (adjustedYawSigned >= yawLT && headTurnLeftSecs >= HEAD_TURN_HOLD) score -= 25
          else if (adjustedYawSigned >= yawLT * 0.6) score -= 8
          if (-adjustedYawSigned >= yawRT && headTurnRightSecs >= HEAD_TURN_HOLD) score -= 25
          else if (-adjustedYawSigned >= yawRT * 0.6) score -= 8
        }
        if (eyesOffSecs >= EYES_OFF_HOLD_SECS) score -= 15
        if (eyesRolledUp) score -= 15
      }

      score = Math.max(0, Math.min(85, score))
      const msSinceDistraction = state.lastDistractionAt ? now - state.lastDistractionAt : Infinity
      const rampRate = msSinceDistraction < RECOVERY_WINDOW_MS ? 0.4 : 1
      if (!trackingUncertain) {
        state.sustainedGoodMs = score >= 72
          ? Math.min(120_000, state.sustainedGoodMs + frameDelta * rampRate)
          : Math.max(0, state.sustainedGoodMs - frameDelta * 3)
      }
      const rawFinal = Math.min(100, score + state.sustainedGoodMs / 120_000 * 15)
      if (!trackingUncertain) {
        state.focusScore = Math.max(0, Math.min(100, rawFinal * 0.3 + state.focusScore * 0.7))
      }
      if (state.focusScore < 55) state.lastDistractionAt = now
      return state.focusScore
    },
  }
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
