// Pure attention/scoring logic, extracted from SessionScreen so it can be tested
// without a browser, a camera or React. Everything here is a pure function of its
// arguments — no refs, no timers, no DOM.
//
// This is where the invariants documented in CLAUDE.md live. Several of them were
// regressions that recurred because nothing enforced them; attention.test.js now
// does. If you change a threshold or a sign here, run `npm test` before committing.

import {
  defaultRoleForType,
  isProductiveDownwardRole,
  isScreenRole,
  normalizeWorkspaceObjects,
} from './workspaceObjects'

// ── FaceMesh landmark indices ────────────────────────────────────────────────
export const RIGHT_EYE   = [33,  160, 158, 133, 153, 144]
export const LEFT_EYE    = [263, 387, 385, 362, 380, 373]
export const IRIS_R_CTR  = 468
export const IRIS_L_CTR  = 473
export const NOSE_TIP    = 1
export const FOREHEAD    = 10
export const CHIN        = 152
export const EYE_L_OUT   = 33
export const EYE_R_OUT   = 263
export const MOUTH_L     = 61
export const MOUTH_R     = 291
export const MOUTH_TOP   = 13
export const MOUTH_BOT   = 14
export const MOUTH_T2    = 312
export const MOUTH_B2    = 317

export const PITCH_NEUTRAL       = 0.50
export const PHONE_PITCH_THRESH  = 38
export const CALIBRATION_SECS    = 20
export const RECOVERY_WINDOW_MS  = 120_000
export const RAMP_STREAK_SECS    = 20   // unbroken seconds at/above the focused threshold → Ramp
export const LOCK_IN_STREAK_SECS = 240  // …and 4 min of it → Lock-in

// ── The score bands ──────────────────────────────────────────────────────────
// The bars a live score has to clear. They were once returned by an energy
// profile; that profile is gone (energy must not move the ruler — see AGENTS.md
// §5), so they live here as plain constants, named and tested.
//
// They are named rather than inline because collapsing one is silent and
// catastrophic: `focused` decides `focusedSeconds`, which IS the reported focus
// percentage, and every downstream feature — history trends, calibration, the
// end screen, the CSV export — is computed from it. When these three were
// briefly replaced by the literal 1, every second of every session counted as
// focused and the metric stopped telling a good session from a bad one.
export const FOCUSED_SCORE     = 40  // a second counts toward focusedSeconds
export const GOOD_STREAK_SCORE = 65  // …and toward the ramp / lock-in streak
export const FLOW_SCORE        = 72  // flow needs "good", not merely "not drifting"

/** Does this second count as focused? The one call site that defines the
 *  headline metric, kept pure so a test can hold it in place. */
export function isFocusedSecond(score) {
  return Number.isFinite(score) && score >= FOCUSED_SCORE
}

export function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

// ── Circadian ────────────────────────────────────────────────────────────────
// Research: post-lunch dip 13:00–15:00 (Monk 2005); night fatigue 23:00–06:00
// (Czeisler 1999). Returns < 1.0 during tired hours. INVARIANT: callers must
// MULTIPLY the alert delay by this, never divide — tired hours have to make the
// alert fire SOONER. This exact line has been inverted and re-fixed before.
export function getCircadianFactor(now = new Date()) {
  const h = now.getHours()
  if (h >= 23 || h < 6) return 0.75   // night owl — more lenient: 75% strictness
  if (h >= 13 && h < 15) return 0.85  // post-lunch dip — mildly lenient
  return 1.0                           // normal hours
}

// ── Workspace-derived thresholds ─────────────────────────────────────────────
export function computeThresholds(devices = []) {
  // Science: ergonomic laptop posture = 15-20° downward head pitch is NORMAL (Stanford, Pitt).
  // Default pitchDown starts at 25° to avoid false-positives for laptop users.
  // Explicit laptop device bumps it further to 30° (user is definitely looking down at screen).
  let yawLeft = 30, yawRight = 30, pitchDown = 25, pitchUp = 15, yawNeutral = 0
  const workspaceObjects = normalizeWorkspaceObjects(devices)
  const camera = workspaceObjects.find(d => d.type === 'camera')
  const hasLaptop = workspaceObjects.some(d => d.type === 'laptop')
  if (hasLaptop) pitchDown = 30  // laptop = 15-20° natural downward gaze, 30° is safe threshold

  for (const d of workspaceObjects) {
    const role = d.role || defaultRoleForType(d.type)
    const isScreen = isScreenRole(role)
    const col = d.col ?? 0.5
    const row = d.row ?? 0.5
    // Widen yaw tolerance for any screen that's off-center.
    // Use 0.45/0.55 boundary to match classifyHorizontalAttention — prevents
    // situation where monitor is "configured" but yaw threshold isn't widened.
    if (isScreen && col < 0.45)  yawLeft   = Math.max(yawLeft,   55)
    if (isScreen && col > 0.55)  yawRight  = Math.max(yawRight,  55)
    if (isScreen && row > 0.6)   pitchUp   = Math.max(pitchUp,   28)
    if (isScreen && row < 0.3)   pitchDown = Math.max(pitchDown, 35)
    if (isProductiveDownwardRole(role) && row < 0.45) pitchDown = Math.max(pitchDown, 34)
  }

  const cameraRow = camera?.row ?? 0.0
  const cameraCol = camera?.col ?? 0.5
  if (camera) {
    if (cameraRow > 0.6) pitchDown = Math.max(12, pitchDown - 8)
    if (cameraCol < 0.2) yawLeft = Math.max(12, yawLeft - 15)
    if (cameraCol > 0.8) yawRight = Math.max(12, yawRight - 15)
  }

  const workZonePitchMin = cameraRow > 0.5 ? 8 : 3
  const workZonePitchMax = Math.max(
    workZonePitchMin + 4,
    pitchDown * (cameraRow > 0.5 ? 0.85 : 0.7)
  )

  return { yawLeft, yawRight, yawNeutral, pitchDown, pitchUp, workZonePitchMin, workZonePitchMax }
}

// ── Focus phases ─────────────────────────────────────────────────────────────
// Driven by goodStreakSecs — how long the (smoothed) score has held at/above the
// 'focused' threshold — NOT by the score's own ramp accumulator. That accumulator
// only grows while the RAW score is >= 72 and decays at 3x, so from a base of 68
// any small dip wiped it out: it effectively never reached the threshold this
// used to require, and every phase fell through to 'arrival' for whole sessions.
export function classifyFocusPhase({
  elapsedSecs,
  score,
  goodStreakSecs,
  msSinceDistraction,
  preDriftActive,
  inFlow,
}) {
  if (score < 40) return 'drift'
  if (msSinceDistraction < RECOVERY_WINDOW_MS) return 'recovery'
  if (preDriftActive || (score >= 55 && score < 65)) return 'fade'
  if (inFlow || goodStreakSecs >= LOCK_IN_STREAK_SECS) return 'lock_in'
  if (goodStreakSecs >= RAMP_STREAK_SECS) return 'ramp'
  if (elapsedSecs < CALIBRATION_SECS + 90) return 'arrival'
  return score >= 65 ? 'ramp' : 'arrival'
}

// ── Where the user is looking ────────────────────────────────────────────────
export function classifyDownwardAttention(devices = [], pitchDeg = 0, yawSigned = 0) {
  if (pitchDeg < 18) return { kind: 'none' }

  const workspaceObjects = normalizeWorkspaceObjects(devices)
  const gazeCol = clamp01(0.5 - yawSigned / 90)
  const downwardObjects = workspaceObjects
    .filter(d => (d.row ?? 0.5) <= 0.58)
    .map(d => ({
      object: d,
      role: d.role || defaultRoleForType(d.type),
      colDistance: Math.abs((d.col ?? 0.5) - gazeCol),
      rowDistance: Math.abs((d.row ?? 0.25) - 0.22),
    }))
    .filter(item => item.colDistance <= 0.32)
    .sort((a, b) => (a.colDistance + a.rowDistance * 0.35) - (b.colDistance + b.rowDistance * 0.35))

  const distraction = downwardObjects.find(item =>
    item.object.type === 'phone' || item.role === 'distraction_device'
  )
  const productive = downwardObjects.find(item => isProductiveDownwardRole(item.role))

  if (distraction && (pitchDeg >= PHONE_PITCH_THRESH * 0.85 || !productive || distraction.colDistance <= productive.colDistance + 0.08)) {
    return { kind: 'distraction', object: distraction.object, role: distraction.role }
  }
  if (productive) return { kind: 'productive', object: productive.object, role: productive.role }
  if (pitchDeg >= PHONE_PITCH_THRESH) return { kind: 'unknown_phone' }
  return { kind: 'unknown' }
}

export function classifyHorizontalAttention(devices = [], yawSigned = 0) {
  if (Math.abs(yawSigned) < 10) return { kind: 'center' }

  const workspaceObjects = normalizeWorkspaceObjects(devices)

  // Use col < 0.45 / col > 0.55 as the screen-side boundary.
  // Wizard places side monitors at col=0.2 (left) and col=0.8 (right).
  // col=0.35/0.65 would cut them off — wider boundary is correct.
  const leftScreens = workspaceObjects.filter(d => {
    const role = d.role || defaultRoleForType(d.type)
    return isScreenRole(role) && (d.col ?? 0.5) < 0.45
  })
  const rightScreens = workspaceObjects.filter(d => {
    const role = d.role || defaultRoleForType(d.type)
    return isScreenRole(role) && (d.col ?? 0.5) > 0.55
  })

  const hasLeftScreen  = leftScreens.length > 0
  const hasRightScreen = rightScreens.length > 0

  // INVARIANT: yaw+ = head turned to the user's LEFT. This matches the head-turn
  // counters and gazeCol, and is confirmed by live gaze data. A LEFT turn is
  // productive only when there's a LEFT-side screen. This pairing was once
  // inverted, which made "looking left" read as "productively facing the right
  // monitor" — suppressing the head-turn penalty AND handing out a +5 bonus.
  // 15° rather than 20°: users don't turn far for a side monitor.
  if (yawSigned > 15  && hasLeftScreen)  return { kind: 'productive_left' }
  if (yawSigned < -15 && hasRightScreen) return { kind: 'productive_right' }
  if (Math.abs(yawSigned) > 30) return { kind: 'unknown_horizontal' }
  return { kind: 'center' }
}

// Calibration identifies a configured object; it never changes score bands or
// penalties. Anchors are relative to the primary screen and translated by the
// current session's neutral pose, so everyday seating drift is not mistaken for
// a new workspace.
export function classifyCalibratedWorkspace(workspace, signal, neutral = {}) {
  const targets = workspace?.calibration?.targets
  if (!targets || !signal || !workspace?.objects?.length) return null
  const yawNeutral = Number(neutral.yawSigned) || 0
  const pitchNeutral = Number(neutral.pitchDeg) || 0
  const irisNeutral = Number(neutral.irisH) || 0
  let best = null
  for (const object of workspace.objects) {
    const target = targets[object.id]
    if (!target || target.quality < 0.35 || target.sampleCount < 20) continue
    const yawDistance = Math.abs(signal.yawSigned - (yawNeutral + target.deltaYaw)) / 12
    const pitchDistance = Math.abs(signal.pitchDeg - (pitchNeutral + target.deltaPitch)) / 10
    const irisDistance = Math.abs(signal.irisH - (irisNeutral + target.deltaIrisH)) / 0.12
    const distance = Math.sqrt(yawDistance ** 2 + pitchDistance ** 2 + irisDistance ** 2)
    if (!best || distance < best.distance) {
      best = { object, role: object.role || defaultRoleForType(object.type), distance }
    }
  }
  return best && best.distance <= 1.5 ? best : null
}

// ── Landmark geometry ────────────────────────────────────────────────────────
export function dist2d(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

export function eyeAspectRatio(lms, idx) {
  const [i1, i2, i3, i4, i5, i6] = idx
  return (dist2d(lms[i2], lms[i6]) + dist2d(lms[i3], lms[i5])) / (2 * dist2d(lms[i1], lms[i4]))
}

export function mouthAspectRatio(lms) {
  const w = dist2d(lms[MOUTH_L], lms[MOUTH_R])
  if (w < 0.01) return 0
  return (dist2d(lms[MOUTH_TOP], lms[MOUTH_BOT]) + dist2d(lms[MOUTH_T2], lms[MOUTH_B2])) / (2 * w)
}

export function irisVerticalGaze(lms) {
  if (!lms[IRIS_R_CTR] || !lms[IRIS_L_CTR]) return 0
  const rUpper = lms[160], rLower = lms[144], rIris = lms[IRIS_R_CTR]
  const lUpper = lms[387], lLower = lms[373], lIris = lms[IRIS_L_CTR]
  const rMid  = (rUpper.y + rLower.y) / 2
  const lMid  = (lUpper.y + lLower.y) / 2
  const rH    = Math.abs(rLower.y - rUpper.y)
  const lH    = Math.abs(lLower.y - lUpper.y)
  const rOff  = rH > 0.001 ? (rMid - rIris.y) / rH : 0
  const lOff  = lH > 0.001 ? (lMid - lIris.y) / lH : 0
  return (rOff + lOff) / 2
}

// Horizontal eye gaze — the signal the old system was missing entirely.
// Iris centre X relative to the midpoint between the eye's inner/outer corners,
// normalized by eye width, averaged over both eyes. Sign is arbitrary until
// calibrated against the user's neutral (looking-at-screen) position. Combined
// with head yaw during scoring, this catches "head straight, eyes off to the
// side/phone" — which head pose alone reads (wrongly) as focused.
// INVARIANT: iris+ = eyes toward the user's RIGHT, i.e. the OPPOSITE mirror
// convention to yawSigned. Scoring depends on that opposition.
export function irisHorizontalGaze(lms) {
  if (!lms[IRIS_R_CTR] || !lms[IRIS_L_CTR]) return 0
  const rOut = lms[33],  rIn = lms[133], rIris = lms[IRIS_R_CTR]
  const lOut = lms[263], lIn = lms[362], lIris = lms[IRIS_L_CTR]
  const rMid = (rOut.x + rIn.x) / 2
  const lMid = (lOut.x + lIn.x) / 2
  const rW   = Math.abs(rIn.x - rOut.x)
  const lW   = Math.abs(lIn.x - lOut.x)
  const rOff = rW > 0.001 ? (rIris.x - rMid) / rW : 0
  const lOff = lW > 0.001 ? (lIris.x - lMid) / lW : 0
  return (rOff + lOff) / 2
}

export function headVariance(history) {
  if (history.length < 3) return 0
  const xs = history.map(p => p.x), ys = history.map(p => p.y)
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  const vx = xs.reduce((a, b) => a + (b - mx) ** 2, 0) / xs.length
  const vy = ys.reduce((a, b) => a + (b - my) ** 2, 0) / ys.length
  return Math.sqrt(vx + vy)
}

export function analyzeFrame(lms) {
  const avgEar = (eyeAspectRatio(lms, RIGHT_EYE) + eyeAspectRatio(lms, LEFT_EYE)) / 2
  const nose = lms[NOSE_TIP], top = lms[FOREHEAD], chin = lms[CHIN]
  const faceH      = chin.y - top.y
  const lowerRatio = faceH > 0.01 ? (chin.y - nose.y) / faceH : PITCH_NEUTRAL
  const pitchDownSin = Math.min(1, Math.max(0, (PITCH_NEUTRAL - lowerRatio) * 2))
  const pitchDeg     = Math.asin(pitchDownSin) * (180 / Math.PI)
  const pitchUpSin   = Math.min(1, Math.max(0, (lowerRatio - PITCH_NEUTRAL) * 2))
  const pitchUpDeg   = Math.asin(pitchUpSin) * (180 / Math.PI)
  const eL       = lms[EYE_L_OUT], eR = lms[EYE_R_OUT]
  const eyeW     = Math.abs(eR.x - eL.x)
  const midX     = (eL.x + eR.x) / 2
  const noseDelta = nose.x - midX
  const yawSin   = eyeW > 0.01 ? Math.min(1, Math.abs(noseDelta / eyeW) * 2) : 0
  const yawMag   = Math.asin(yawSin) * (180 / Math.PI)
  const yawSigned = yawMag * (noseDelta >= 0 ? 1 : -1)
  const mar  = mouthAspectRatio(lms)
  const irisV = irisVerticalGaze(lms)
  const irisH = irisHorizontalGaze(lms)
  const faceScale = eyeW
  return { avgEar, pitchDeg, pitchUpDeg, yawSigned, mar, irisV, irisH, faceScale, nosePt: { x: nose.x, y: nose.y } }
}
