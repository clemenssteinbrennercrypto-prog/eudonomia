import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  defaultRoleForType,
  isProductiveDownwardRole,
  isScreenRole,
  normalizeWorkspaceObjects,
} from '../lib/workspaceObjects'
import {
  fetchCompanionSession,
  getLastActivity,
  isActivityConnected,
  pushCompanionSession,
  setExtensionFallbackSession,
  startActivityPolling,
  stopActivityPolling,
} from '../lib/activityReceiver'
import { getDomainsFromAppPreset } from '../lib/focusAppsConfig'
import { loadFocusAppsConfig, loadStrictMode } from '../lib/storage'
import {
  classifyGoalAwareActivity,
  deriveSessionIntent,
  emptyActivityAlignmentSummary,
  recordActivityAlignment,
} from '../lib/sessionIntent'

// ── FaceMesh landmark indices ──────────────────────────────────────────────────
const RIGHT_EYE   = [33,  160, 158, 133, 153, 144]
const LEFT_EYE    = [263, 387, 385, 362, 380, 373]
const IRIS_R_CTR  = 468
const IRIS_L_CTR  = 473
const NOSE_TIP    = 1
const FOREHEAD    = 10
const CHIN        = 152
const EYE_L_OUT   = 33
const EYE_R_OUT   = 263
const MOUTH_L     = 61
const MOUTH_R     = 291
const MOUTH_TOP   = 13
const MOUTH_BOT   = 14
const MOUTH_T2    = 312
const MOUTH_B2    = 317

// ── Thresholds ────────────────────────────────────────────────────────────────
// Science sources:
//  • EAR blink/heavy: Soukupová & Čech (2016), dlib 68-pt model, EAR < 0.20 = blink
//  • PROLONGED_CLOSE_MS: fatigue eye closure > 500ms (PMC3836343), microsleep ≥ 1000ms
//    → 800ms = early fatigue warning; 1500ms = confirmed impairment (kept for penalty trigger)
//  • MAR_YAWN: 0.50 per Weng et al. (MDPI 2022) — threshold in 20-frame sequence
//  • BLINK_WIN_MS: 20s window gives ~4 blinks minimum at 12/min — adequate signal
//  • PERCLOS_WIN_MS: 30s (shortened from 60s) — office/study use responds faster than driving;
//    Wierwille (1994) 60s was for highway driving. 30s validated in PMC10108649.
const EAR_BLINK              = 0.20
const EAR_HEAVY              = 0.15
const EAR_PROLONGED_CLOSE    = 0.18
const PROLONGED_CLOSE_MS     = 1500  // confirmed fatigue/microsleep penalty threshold
const EARLY_MICROSLEEP_MS    = 800   // 500ms+ closures = drowsiness signal (PMC3836343)
const MAR_YAWN               = 0.50  // Weng et al. MDPI 2022: 0.5 in consecutive frames
const YAWN_HOLD_MS           = 1500
const BLINK_WIN_MS           = 20_000
const PERCLOS_WIN_MS         = 30_000 // shortened: 30s catches fatigue faster for desk work
const PITCH_NEUTRAL       = 0.50
const PITCH_UP_THRESH     = 15
const PHONE_PITCH_THRESH  = 38
const PHONE_HOLD_MS       = 4000
const DISTRACTION_DOWN_HOLD_MS = 2500  // hold time before a classified distraction-device
                                        // glance triggers the severe penalty (avoid 1-frame flicker)
const HEAD_DOWN_HOLD      = 10
const HEAD_TURN_HOLD      = 5
const FACE_ABSENT_HOLD_MS = 4000
const HEAD_DRIFT_WIN_MS   = 3000
const HEAD_DRIFT_THRESH   = 0.035
const ALERT_COOLDOWN_MS      = 60_000
const GENTLE_REMINDER_DELAY_MS = 60_000
const GENTLE_REMINDER_COOLDOWN_MS = 5 * 60_000
const GENTLE_REMINDER_SEVERE_BUFFER_MS = 15_000
const SCORE_UPDATE_SECS      = 5
const CALIBRATION_SECS       = 20
const EAR_RECALIB_INTERVAL   = 600_000  // re-calibrate EAR baseline every 10 min
// Real horizontal gaze: iris deflection past the personal neutral, normalized by
// eye width. Beyond normal on-screen scanning (~±0.10) but not full deflection.
// Conservative to protect trust — combined with a 3-frame deadzone + hold, a
// side glance or saccade never triggers a false "distracted".
const IRIS_OFF_H             = 0.07   // eye deflection past neutral = off-screen (live data: neutral ~0.00, full look-away ~0.10)
const EYES_OFF_HOLD_SECS     = 1.5    // sustained eyes-off before the (mild) penalty
const CAMERA_STALL_MS        = 10_000 // no camera frame for this long = pipeline fault (generous: MediaPipe WASM cold-start)
const CAMERA_RECOVER_MS      = 3_000  // frames stopped AFTER having flowed = try rebuilding the pipeline (sleep/wake)
const CAMERA_RECOVER_TRIES   = 3      // silent rebuild attempts before surfacing a fault
const CAMERA_FAULT_COPY = {
  permission: {
    title: 'Eudaimonia can’t see your camera',
    hint: 'Camera access was blocked. Allow it for this app in your browser or in System Settings → Privacy & Security → Camera, then start a new session.',
  },
  busy: {
    title: 'Your camera is in use by another app',
    hint: 'Something else (a video call, or another browser tab) is holding the camera. Close it, then start a new session.',
  },
  no_camera: {
    title: 'No camera found',
    hint: 'Focus tracking needs a webcam. Connect one and start a new session.',
  },
  library: {
    title: 'Face tracking couldn’t load',
    hint: 'The tracking engine is downloaded on first use and couldn’t be reached — check your internet connection or any content blocker, then reload.',
  },
  stalled: {
    title: 'The camera stopped sending video',
    hint: 'The camera feed dropped mid-session. Reconnecting it resumes tracking automatically — otherwise close whatever took the camera and start a new session.',
  },
  no_frames: {
    title: 'Face tracking didn’t start',
    hint: 'The camera was allowed, but the tracking engine never began analysing. It downloads on first use — check your internet connection or any content blocker, then start a new session.',
  },
}
const CONF_UNCERTAIN_MAX     = 0.55   // detection confidence at/below this = tracking unreliable (Stage 2 trust)
const UNCERTAIN_HOLD_MS      = 700    // sustained low confidence before surfacing "signal weak" (anti-flicker)
const FLOW_STABLE_MS         = 90_000   // 90s of good signals → flow state
const ACTIVITY_DISTRACTION_HOLD_MS = 10_000
const ACTIVITY_REASON_HOLD_MS      = 30_000
const ACTIVITY_FOCUS_BONUS_PER_TICK = 2
const ACTIVITY_FOCUS_BONUS_MAX      = 10
const ACTIVITY_DISTRACTION_PENALTY_PER_TICK = 5
const ACTIVITY_DISTRACTION_PENALTY_MAX      = 25
const PRE_DRIFT_HOLD_MS             = 10_000
const PRE_DRIFT_DECAY_MULT          = 2.5
const PRE_DRIFT_MAX_MS              = 30_000
const RECOVERY_WINDOW_MS            = 120_000
const RAMP_STREAK_SECS              = 20   // unbroken seconds at/above the focused threshold → Ramp
const LOCK_IN_STREAK_SECS           = 240  // …and 4 min of it → Lock-in

const FOCUS_PHASES = {
  arrival:  { label: 'Arrival',  tone: '#38bdf8' },
  ramp:     { label: 'Ramp',     tone: '#22c55e' },
  lock_in:  { label: 'Lock-in',  tone: '#a78bfa' },
  fade:     { label: 'Fade',     tone: '#f59e0b' },
  recovery: { label: 'Recovery', tone: '#fb7185' },
  drift:    { label: 'Drift',    tone: '#ef4444' },
}

const PHASE_INTERVENTION_POLICY = {
  arrival: {
    alertDelayMult: 1.35,
    gentleDelayMs: 90_000,
    preDriftNudge: false,
    cue: 'Settle in before the system gets strict.',
  },
  ramp: {
    alertDelayMult: 0.8,
    gentleDelayMs: 35_000,
    preDriftNudge: true,
    cue: 'Protect the ramp: close the detour now.',
  },
  lock_in: {
    alertDelayMult: 1.25,
    gentleDelayMs: 150_000,
    preDriftNudge: false,
    cue: 'Lock-in is stable; only major breaks interrupt it.',
  },
  fade: {
    alertDelayMult: 0.85,
    gentleDelayMs: 30_000,
    preDriftNudge: true,
    cue: 'Fade is starting. Reset posture or close the off-goal window.',
  },
  recovery: {
    alertDelayMult: 1.4,
    gentleDelayMs: 90_000,
    preDriftNudge: false,
    cue: 'Recover deliberately: one clean minute back on task.',
  },
  drift: {
    alertDelayMult: 0.75,
    gentleDelayMs: 25_000,
    preDriftNudge: true,
    cue: 'Drift is active. Switch back or pause the session.',
  },
}

const PHASE_ALERT_COPY = {
  arrival: {
    default: { text: 'Settle back into the session.', sub: 'Take one clean minute on the intended task' },
    distraction_app: { text: 'Start on the intended work.', sub: 'Close the detour before the ramp begins' },
    phone: { text: 'Put the phone down.', sub: 'Set the workspace before focus starts' },
  },
  ramp: {
    default: { text: 'Catch this drift now.', sub: 'The ramp is where focus either locks in or slips' },
    distraction_app: { text: 'Switch back now.', sub: 'Protect the ramp before the detour becomes the session' },
    away: { text: 'Back to the work.', sub: 'The ramp needs a clean minute' },
  },
  lock_in: {
    default: { text: 'Brief reset, then return.', sub: 'You were in lock-in; keep the interruption small' },
    distraction_app: { text: 'Close the interruption.', sub: 'Preserve the lock-in block' },
    yawn: { text: 'Take a real break.', sub: 'Lock-in is fading into fatigue' },
    prolonged: { text: 'Take a real break.', sub: 'Rest your eyes before continuing' },
  },
  fade: {
    default: { text: 'Reset before this becomes drift.', sub: 'Stand up, breathe, or simplify the next step' },
    distraction_app: { text: 'Close the off-goal window.', sub: 'Fade is turning into a detour' },
    lookingup: { text: 'Name the next action.', sub: 'Make the task smaller and restart' },
  },
  recovery: {
    default: { text: 'Recover cleanly.', sub: 'One minute back on task before pushing harder' },
    distraction_app: { text: 'Return to the recovery task.', sub: 'Do not stack another detour on the break' },
    phone: { text: 'Put the phone away.', sub: 'Recovery needs fewer inputs, not more' },
  },
  drift: {
    default: { text: 'Pause or switch back.', sub: 'The session has left productive focus' },
    distraction_app: { text: 'Switch back or end the session.', sub: 'This is now active drift' },
    away: { text: 'Return or pause.', sub: 'Do not leave the timer running unattended' },
  },
}

function getPhasePolicy(phase) {
  return PHASE_INTERVENTION_POLICY[phase] || PHASE_INTERVENTION_POLICY.arrival
}

function getPhaseAlertMessage(reason, phase) {
  const base = ALERT_MESSAGES[reason] ?? ALERT_MESSAGES.default
  const phaseCopy = PHASE_ALERT_COPY[phase]?.[reason] || PHASE_ALERT_COPY[phase]?.default
  return phaseCopy ? { ...base, ...phaseCopy } : base
}

// ── Circadian thresholds ───────────────────────────────────────────────────────
// Research: post-lunch dip 13:00–15:00 (Monk 2005); night fatigue 23:00–06:00 (Czeisler 1999)
// We lenient-shift PROLONGED_CLOSE_MS and ALERT delay in these windows.
function getCircadianFactor() {
  const h = new Date().getHours()
  if (h >= 23 || h < 6) return 0.75   // night owl — more lenient: 75% strictness
  if (h >= 13 && h < 15) return 0.85  // post-lunch dip — mildly lenient
  return 1.0                           // normal hours
}

// ── Reason labels (shown below status dot) ───────────────────────────────────
const REASON_LABELS = {
  away:       '→ looking away',
  phone:      '→ phone detected',
  distraction_app: '→ wrong app open',
  prolonged:  '→ eyes tired',
  yawn:       '→ yawning',
  lookingup:  '→ mind wandering',
  focused:    null,
  default:    null,
}

// ── Alert messages ────────────────────────────────────────────────────────────
const ALERT_MESSAGES = {
  default:    { text: 'Hey — come back.',        sub: 'Your session is still running',   icon: null },
  phone:      { text: 'Put the phone down.',     sub: 'Eyes back on the screen',         icon: 'phone' },
  distraction_app: { text: 'Switch back to your work.', sub: 'A distraction app is open', icon: 'away' },
  away:       { text: 'Come back to your work.', sub: 'Your session is still running',   icon: 'away' },
  yawn:       { text: 'Take a 2-minute break.',  sub: 'Stand up, stretch, come back strong', icon: 'yawn' },
  lookingup:  { text: 'Eyes on the task.',       sub: 'Bring your focus back here',      icon: 'lookingup' },
  prolonged:  { text: 'Take a 2-minute break.',  sub: 'Rest your eyes, then continue',   icon: 'yawn' },
}

// ── Overlay icons (inline SVG strings) ────────────────────────────────────────
function OverlayIcon({ type }) {
  if (type === 'phone') return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
      <line x1="12" y1="18" x2="12.01" y2="18"/>
    </svg>
  )
  if (type === 'away') return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
      <path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    </svg>
  )
  if (type === 'yawn') return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
      <circle cx="12" cy="12" r="10"/><path d="M8 15s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
    </svg>
  )
  if (type === 'lookingup') return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/>
    </svg>
  )
  return null
}

function computeThresholds(devices = []) {
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
  const thresholds = { yawLeft, yawRight, yawNeutral, pitchDown, pitchUp, workZonePitchMin, workZonePitchMax }

  if (import.meta.env.DEV) {
    console.log('[thresholds]', { yawLeft, yawRight, pitchDown, pitchUp, cameraRow: camera?.row, cameraCol: camera?.col })
  }

  return thresholds
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

// Phases are driven by goodStreakSecs — how long the (smoothed) score has held
// at/above the 'focused' threshold — NOT by sustainedGoodMsRef. That accumulator
// only grows while the RAW score is >= 72 and decays at 3x, so from a base of 68
// any small dip wiped it out: it effectively never reached the 15s this used to
// require, and every phase fell through to 'arrival' for the whole session.
// ── Camera lifecycle ──────────────────────────────────────────────────────────
// We own this rather than using MediaPipe's Camera helper, which: pops a raw
// `alert()` on failure, drives frames off requestAnimationFrame (which STOPS
// entirely once the page is hidden — i.e. the moment the user switches to the
// app they're actually working in), and has no way to notice or recover from a
// dead MediaStream. Owning it gives us instant track-loss events, our own error
// classification, and a frame pump that survives backgrounding.
const CAMERA_FRAME_MS = 67   // ~15fps, matching the previous cap
const MUTE_GRACE_MS   = 1200 // a track can mute briefly; only a sustained mute is a loss

function createCameraController(videoEl, { width, height, onFrame, onTrackLost }) {
  let stream = null
  let timer = null
  let muteTimer = null
  let stopped = false
  let inFlight = false

  const pump = () => {
    if (stopped) return
    // A timer-driven pump is throttled in a hidden page but never suspended,
    // unlike rAF; tracking degrades to a lower frame rate instead of stopping.
    timer = setTimeout(pump, CAMERA_FRAME_MS)
    if (inFlight || videoEl.readyState < 2) return
    inFlight = true
    Promise.resolve(onFrame()).catch(() => {}).finally(() => { inFlight = false })
  }

  const watchTrack = (track) => {
    track.addEventListener('ended', () => { if (!stopped) onTrackLost('ended') })
    track.addEventListener('mute', () => {
      if (stopped || muteTimer) return
      muteTimer = setTimeout(() => {
        muteTimer = null
        if (!stopped && track.muted) onTrackLost('muted')
      }, MUTE_GRACE_MS)
    })
    track.addEventListener('unmute', () => {
      if (muteTimer) { clearTimeout(muteTimer); muteTimer = null }
    })
  }

  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width, height } })
      if (stopped) {                       // unmounted while acquiring
        stream.getTracks().forEach(t => t.stop())
        stream = null
        return
      }
      videoEl.srcObject = stream
      stream.getVideoTracks().forEach(watchTrack)
      try { await videoEl.play() } catch { /* autoplay is muted+inline; pump anyway */ }
      pump()
    },
    stop() {
      stopped = true
      if (timer) { clearTimeout(timer); timer = null }
      if (muteTimer) { clearTimeout(muteTimer); muteTimer = null }
      try { videoEl.pause() } catch {}
      if (stream) stream.getTracks().forEach(t => t.stop())
      if (videoEl.srcObject === stream) videoEl.srcObject = null
      stream = null
    },
  }
}

function classifyFocusPhase({
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

function classifyDownwardAttention(devices = [], pitchDeg = 0, yawSigned = 0) {
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

function classifyHorizontalAttention(devices = [], yawSigned = 0) {
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

  // Lower the yaw trigger threshold to 15 deg so moderate head turns are caught.
  // A 20 deg threshold was too high — users don't turn that far for a side monitor.
  // yaw+ = head turned to the user's LEFT — this matches the head-turn counters
  // (line ~1222, `adjustedYawSigned >= yawLT` is the LEFT turn) and gazeCol, and is
  // confirmed by live gaze data. So a LEFT turn is productive only when there's a
  // LEFT-side screen, and a RIGHT turn only with a RIGHT screen. This pairing was
  // previously inverted, which made "looking left" read as "productively facing the
  // right monitor" — suppressing the head-turn penalty AND handing out a +5 bonus.
  if (yawSigned > 15  && hasLeftScreen)  return { kind: 'productive_left' }
  if (yawSigned < -15 && hasRightScreen) return { kind: 'productive_right' }
  if (Math.abs(yawSigned) > 30) return { kind: 'unknown_horizontal' }
  return { kind: 'center' }
}

function dist2d(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}
function eyeAspectRatio(lms, idx) {
  const [i1, i2, i3, i4, i5, i6] = idx
  return (dist2d(lms[i2], lms[i6]) + dist2d(lms[i3], lms[i5])) / (2 * dist2d(lms[i1], lms[i4]))
}
function mouthAspectRatio(lms) {
  const w = dist2d(lms[MOUTH_L], lms[MOUTH_R])
  if (w < 0.01) return 0
  return (dist2d(lms[MOUTH_TOP], lms[MOUTH_BOT]) + dist2d(lms[MOUTH_T2], lms[MOUTH_B2])) / (2 * w)
}
function irisVerticalGaze(lms) {
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
// calibrated against the user's neutral (looking-at-screen) position; positive
// and negative just mean "iris shifted toward one side vs the other". Combined
// with head yaw during scoring, this catches "head straight, eyes off to the
// side/phone" — which head pose alone reads (wrongly) as focused.
function irisHorizontalGaze(lms) {
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
function headVariance(history) {
  if (history.length < 3) return 0
  const xs = history.map(p => p.x), ys = history.map(p => p.y)
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  const vx = xs.reduce((a, b) => a + (b - mx) ** 2, 0) / xs.length
  const vy = ys.reduce((a, b) => a + (b - my) ** 2, 0) / ys.length
  return Math.sqrt(vx + vy)
}
function analyzeFrame(lms) {
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

// ── Web Audio ─────────────────────────────────────────────────────────────────
let _sharedAudioCtx = null
function getAudioCtx() {
  if (!_sharedAudioCtx || _sharedAudioCtx.state === 'closed') {
    _sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  return _sharedAudioCtx
}
function playAlertSound() {
  try {
    const ctx = getAudioCtx()
    if (ctx.state === 'suspended') ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(440, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(330, ctx.currentTime + 1.5)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.2)
    gain.gain.setValueAtTime(0.15, ctx.currentTime + 1.0)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.5)
    osc.start(); osc.stop(ctx.currentTime + 2.5)
  } catch {}
}
function playGentleReminderSound() {
  try {
    const ctx = getAudioCtx()
    if (ctx.state === 'suspended') ctx.resume()

    const master = ctx.createGain()
    master.gain.setValueAtTime(0.0001, ctx.currentTime)
    master.gain.linearRampToValueAtTime(0.035, ctx.currentTime + 0.08)
    master.gain.setValueAtTime(0.035, ctx.currentTime + 0.55)
    master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.25)
    master.connect(ctx.destination)

    const notes = [
      { freq: 523.25, start: 0, stop: 0.75 },
      { freq: 659.25, start: 0.18, stop: 1.15 },
    ]

    notes.forEach(({ freq, start, stop }) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start)
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start)
      gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + start + 0.08)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + stop)
      osc.connect(gain)
      gain.connect(master)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + stop)
    })
  } catch {}
}

// ── Ambient Sound Engine ──────────────────────────────────────────────────────
const AMBIENT_MODES = ['off', 'rain', 'white', 'brown']
const AMBIENT_LABELS = { off: 'Off', rain: 'Rain', white: 'White', brown: 'Brown' }

function createAmbientSource(ctx, mode) {
  const bufferSize = ctx.sampleRate * 2
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
  const data = buffer.getChannelData(0)

  if (mode === 'white') {
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1
  } else if (mode === 'brown' || mode === 'rain') {
    let prev = 0
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1
      prev = prev * 0.99 + white * 0.01
      data[i] = prev
    }
    // Normalize brown
    const max = Math.max(...data.map(Math.abs))
    if (max > 0) for (let i = 0; i < bufferSize; i++) data[i] /= max
  }

  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = true

  const gain = ctx.createGain()
  gain.gain.value = 0.06

  if (mode === 'rain') {
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 400
    source.connect(filter)
    filter.connect(gain)
  } else {
    source.connect(gain)
  }
  gain.connect(ctx.destination)
  return { source, gain }
}

function formatTime(s) {
  const m   = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function formatShortDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  if (mins <= 0) return `${secs}s`
  return `${mins}m ${String(secs).padStart(2, '0')}s`
}

// ── Focus Ring (SVG) ──────────────────────────────────────────────────────────
function FocusRing({ score, timeLeft, isCalibrating, isPaused, calibProgress = 0 }) {
  const size   = 220
  const radius = 96
  const stroke = 10
  const circ   = 2 * Math.PI * radius
  const fill   = isCalibrating ? calibProgress : score / 100
  const offset = circ * (1 - fill)

  const color = isCalibrating
    ? '#94a3b8'
    : score >= 65 ? '#22c55e'
    : score >= 38 ? '#f97316'
    : '#ef4444'

  return (
    <div className={isCalibrating ? 'ring--calibrating' : ''} style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      <svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0, filter: isCalibrating ? 'none' : score >= 65 ? 'drop-shadow(0 0 12px rgba(34,197,94,0.25))' : score >= 38 ? 'drop-shadow(0 0 12px rgba(249,115,22,0.2))' : 'drop-shadow(0 0 12px rgba(239,68,68,0.2))' }}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="#1C1F28" strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.4s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 0,
      }}>
        <span className="timer" style={{ fontSize: 42, lineHeight: 1, color: isPaused ? '#4b5563' : '#ffffff', fontWeight: 200 }}>{formatTime(timeLeft)}</span>
      </div>
    </div>
  )
}

// ── Status dot ────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  focused:    { color: '#22c55e', label: 'Focused'    },
  distracted: { color: '#f97316', label: 'Distracted' },
  alert:      { color: '#ef4444', label: 'Alert'      },
  uncertain:  { color: '#94a3b8', label: 'Signal weak'},
  calibrating:{ color: '#94a3b8', label: 'Calibrating'},
}

// ── Signal quality bars ───────────────────────────────────────────────────────
function SignalBars({ confidence }) {
  // 0..1 → 0, 1, 2, or 3 filled bars
  const filled = confidence >= 0.85 ? 3 : confidence >= 0.5 ? 2 : confidence >= 0.2 ? 1 : 0
  const barColor = filled === 3 ? '#22c55e' : filled >= 1 ? '#f97316' : '#6b7280'
  return (
    <div title={`Detection quality: ${Math.round(confidence * 100)}%`} style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          width: 3,
          height: 4 + i * 3,
          borderRadius: 1.5,
          background: i <= filled ? barColor : '#2A2E3A',
          transition: 'background 0.4s',
        }} />
      ))}
    </div>
  )
}

// ── Sparkline ──────────────────────────────────────────────────────────────
function Sparkline({ scores, scoreColor }) {
  if (!scores || scores.length < 2) return null
  const W = 80, H = 24, PAD = 2
  const pts = scores
  const mn = 0, mx = 100
  const points = pts.map((v, i) => {
    const x = PAD + (i / (pts.length - 1)) * (W - PAD * 2)
    const y = PAD + (1 - (v - mn) / (mx - mn)) * (H - PAD * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={W} height={H} style={{ display: 'block', opacity: 0.7 }}>
      <polyline
        points={points}
        fill="none"
        stroke={scoreColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StatusDot({ status, score, reason, isCalibrating, confidence = 0, scoreHistory = [] }) {
  const cfg = isCalibrating ? STATUS_CONFIG.calibrating : (STATUS_CONFIG[status] ?? STATUS_CONFIG.focused)
  const { color, label } = cfg
  const showReason = !isCalibrating && (status === 'distracted' || status === 'alert')
  const reasonText = showReason ? (REASON_LABELS[reason] ?? null) : null

  // Trend arrow — compare score every 10s
  const prevScoreRef = useRef(score)
  const scoreRef = useRef(score)
  scoreRef.current = score
  const [trend, setTrend] = useState('→')
  useEffect(() => {
    const interval = setInterval(() => {
      const prev = prevScoreRef.current
      const curr = scoreRef.current
      if (curr - prev >= 3) setTrend('↑')
      else if (prev - curr >= 3) setTrend('↓')
      else setTrend('→')
      prevScoreRef.current = curr
    }, 10000)
    return () => clearInterval(interval)
  }, []) // stable interval — reads via ref
  const trendColor = trend === '↑' ? '#22c55e' : trend === '↓' ? '#ef4444' : '#6b7280'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '5px 12px',
        background: '#1C1F28',
        border: '1px solid #2A2E3A',
        borderRadius: 100,
      }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: color,
          boxShadow: `0 0 0 2.5px ${color}28`,
          flexShrink: 0,
          animation: status === 'alert' && !isCalibrating ? 'dotPulse 1.1s ease-in-out infinite' : 'none',
          transition: 'background 0.4s',
        }} />
        <span style={{ fontSize: 12, fontWeight: 500, color: '#94a3b8', letterSpacing: '0.01em', textTransform: 'capitalize' }}>
          {label}
        </span>
        <span style={{ fontSize: 11, color: '#2A2E3A' }}>·</span>
        <span style={{ fontSize: 12, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums', transition: 'color 0.4s' }}>
          {isCalibrating ? '--' : score}
        </span>
        {!isCalibrating && (
          <span style={{ fontSize: 10, color: trendColor, opacity: 0.7, lineHeight: 1 }}>{trend}</span>
        )}
        {!isCalibrating && <SignalBars confidence={confidence} />}
      </div>
      {!isCalibrating && scoreHistory.length >= 2 && (
        <div style={{ paddingRight: 4 }}>
          <Sparkline scores={scoreHistory} scoreColor={color} />
        </div>
      )}
      {reasonText && (
        <div style={{
          padding: '3px 10px',
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 100,
          fontSize: 11,
          color: '#6b7280',
          fontWeight: 500,
          letterSpacing: '0.01em',
          transition: 'opacity 0.3s',
        }}>
          {reasonText}
        </div>
      )}
    </div>
  )
}

function ActivityPill({ activity, classification, connected, activeSince, prominent = false }) {
  const kind = classification?.kind || 'unclear'
  const isFocus = connected && (kind === 'aligned' || kind === 'supportive')
  const isDistraction = connected && (kind === 'blocked' || kind === 'distraction')
  const isOffGoal = connected && kind === 'off_goal'
  const color = isFocus ? '#22c55e' : isDistraction ? '#ef4444' : isOffGoal ? '#f59e0b' : '#6b7280'
  const bg = isFocus ? '#17251d' : isDistraction ? '#2a1719' : isOffGoal ? '#2b2416' : '#1C1F28'
  const border = isFocus ? '#22c55e40' : isDistraction ? '#ef444440' : isOffGoal ? '#f59e0b40' : '#2A2E3A'
  const label = connected ? classification.label : 'No activity data'
  const duration = isDistraction && activeSince ? formatShortDuration(Date.now() - activeSince) : null
  const suffix = connected ? ({
    aligned: 'aligned',
    supportive: 'supportive',
    blocked: 'blocked',
    distraction: 'distraction',
    off_goal: 'off goal',
    unclear: null,
  }[kind] || null) : null
  const titleParts = [
    activity?.domain,
    activity?.title,
    activity?.app,
    activity?.full_url,
    activity?.url,
    activity?.window,
  ].filter(Boolean)

  return (
    <div style={{
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: prominent && isDistraction ? 5 : 0,
      minWidth: 0,
      maxWidth: prominent ? 320 : 220,
    }}>
      <div
        title={titleParts.length ? titleParts.join(' · ') : undefined}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 100,
          padding: prominent ? '8px 14px 8px 8px' : '6px 10px 6px 7px',
          fontSize: prominent ? 12 : 11,
          fontWeight: 800,
          color: connected ? '#cbd5e1' : '#6b7280',
          width: prominent ? 'min(320px, calc(100vw - 48px))' : 'auto',
          maxWidth: prominent ? 'min(320px, calc(100vw - 48px))' : 220,
          minWidth: 0,
          boxShadow: isDistraction
            ? '0 0 0 2px rgba(239,68,68,0.14), 0 0 24px rgba(239,68,68,0.24)'
            : isFocus
              ? '0 0 0 2px rgba(34,197,94,0.10), 0 0 20px rgba(34,197,94,0.16)'
              : 'none',
          animation: isDistraction ? 'activityDistractionPulse 1.4s ease-in-out infinite' : 'none',
        }}
      >
        <span style={{
          width: prominent ? 26 : 22,
          height: prominent ? 26 : 22,
          borderRadius: '50%',
          background: connected ? color : '#374151',
          color: '#0D0F14',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 900,
          flexShrink: 0,
          boxShadow: connected ? `0 0 12px ${color}55` : 'none',
        }}>
          {connected && label ? label.charAt(0).toUpperCase() : '-'}
        </span>
        <span style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
          flex: 1,
        }}>
          {duration ? `${label} · ${duration}` : label}
        </span>
        {suffix && (
          <span style={{ color: '#86efac', fontSize: 10, fontWeight: 900, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {suffix}
          </span>
        )}
      </div>
      {prominent && isDistraction && (
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#fca5a5',
          letterSpacing: '0.01em',
          textShadow: '0 0 12px rgba(239,68,68,0.25)',
        }}>
          {kind === 'blocked' ? 'Blocked by your focus rules' : 'Likely distraction for this session'}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SessionScreen({ task, goal = '', tags = [], duration, devices = [], focusModeEnabled = true, onEnd }) {
  const totalSeconds = duration * 60
  const sessionIntent = useMemo(() => deriveSessionIntent({ task, goal, tags }), [task, goal, tags])
  const {
    yawLeft: yawLT,
    yawRight: yawRT,
    yawNeutral,
    pitchDown: pitchDT,
    pitchUp: pitchUpDT,
    workZonePitchMin,
    workZonePitchMax,
  } = computeThresholds(devices)
  const alertDelayMs = devices.length >= 1 ? 120_000 : 90_000

  const [timeLeft,        setTimeLeft]        = useState(totalSeconds)
  const [showOverlay,     setShowOverlay]     = useState(false)
  const [alertReason,     setAlertReason]     = useState('default')
  const [attentionStatus, setAttentionStatus] = useState('focused')
  const [distractReason,  setDistractReason]  = useState('focused')
  const [focusScore,      setFocusScore]      = useState(68)
  const [camHidden,       setCamHidden]       = useState(false)
  const [camSize,         setCamSize]         = useState('full') // 'full' | 'mini'
  const [isPaused,        setIsPaused]        = useState(false)
  const [cameraFault,     setCameraFault]     = useState(null) // null | 'permission' | 'busy' | 'no_camera' | 'library' | 'stalled' | 'no_frames'
  const [cameraEpoch,     setCameraEpoch]     = useState(0)    // bump = tear down and rebuild the camera pipeline
  const [isCalibrating,   setIsCalibrating]   = useState(true)
  const [calibProgress,   setCalibProgress]   = useState(0) // 0..1 during calibration
  const [showReady,       setShowReady]       = useState(false) // brief "Ready" flash
  const [currentStreak,   setCurrentStreak]   = useState(0)
  const [ambientMode,     setAmbientMode]     = useState(() => {
    try { return localStorage.getItem('eudaimonia_ambient_pref') || 'off' } catch { return 'off' }
  })
  const [gentleReminderEnabled, setGentleReminderEnabled] = useState(() => {
    try { return localStorage.getItem('eudaimonia_gentle_reminder_pref') !== 'off' } catch { return true }
  })
  const [breakBanner,     setBreakBanner]     = useState(null) // {msg, id}
  const [dismissedBreaks, setDismissedBreaks] = useState(new Set())
  const [milestone,       setMilestone]       = useState(null) // {msg}
  const [phaseCue,        setPhaseCue]        = useState(null) // {msg, phase}
  const [inFlowState,     setInFlowState]     = useState(false)
  const [preDriftRisk,    setPreDriftRisk]    = useState({ active: false, level: 0, reason: 'stable' })
  const [focusPhase,      setFocusPhase]      = useState('arrival')
  const [distractionCount, setDistractionCount] = useState(0)
  const [hintVisible,     setHintVisible]     = useState(true)
  const [endConfirm,      setEndConfirm]      = useState(false)
  const [faceAbsentPrompt, setFaceAbsentPrompt] = useState(false)
  const [gazePos,         setGazePos]         = useState(null) // {x, y} normalized 0..1
  const [detectionConf,   setDetectionConf]   = useState(0)   // 0..1 signal quality
  const [scoreHistory,    setScoreHistory]    = useState([68])
  const [activityStatus,  setActivityStatus]  = useState(() => getLastActivity())

  const videoRef        = useRef(null)
  const sessionEndedRef = useRef(false)
  const startTimeRef    = useRef(Date.now())
  const isPausedRef     = useRef(false)
  const pausedAtRef     = useRef(null) // timestamp when paused
  const pausedTotalRef  = useRef(0)    // total ms spent paused
  const timeLeftRef     = useRef(totalSeconds)
  const companionSessionHadActiveRef = useRef(false)
  const lastActivePushAtRef    = useRef(0)   // when we last told the companion this session is active

  // ── Detection rolling buffers ─────────────────────────────────────────────
  const blinkTimestampsRef     = useRef([])
  const wasClosedRef           = useRef(false)
  const perclosHistRef         = useRef([])
  const headDownStartRef       = useRef(null)
  const headTurnLeftStartRef   = useRef(null)
  const headTurnRightStartRef  = useRef(null)
  const eyesClosedSinceRef     = useRef(null)
  const yawnStartRef           = useRef(null)
  const phoneStartRef          = useRef(null)
  const distractionDownStartRef = useRef(null)
  const lookingUpStartRef      = useRef(null)
  const faceAbsentSinceRef     = useRef(null)
  const nosePtHistRef          = useRef([])

  // ── Score & alert refs ────────────────────────────────────────────────────
  const scoreHistoryRef        = useRef([68]) // last 60 score values for sparkline
  const focusScoreRef          = useRef(68)
  const lastFrameAtRef         = useRef(0)     // last time the camera pipeline delivered a frame
  const cameraFaultRef         = useRef(null)  // mirrors cameraFault for the interval callback
  const cameraRecoverTriesRef  = useRef(0)     // consecutive silent rebuild attempts
  const lastRecoverAtRef       = useRef(0)     // cooldown between rebuild attempts
  const rawScoreRef            = useRef(68)
  const scoreLowSinceRef       = useRef(null)
  const sustainedGoodMsRef     = useRef(0)   // ms of consecutive good focus (for ramp-up bonus)
  const lastFrameTsRef         = useRef(0)
  const lastDistractionRef     = useRef(0)   // timestamp of last distraction event (alert or prolonged low score)
  const lastAlertTimeRef       = useRef(0)
  const overlayActiveRef       = useRef(false)
  const attentionStatusRef     = useRef('focused')
  const currentReasonRef       = useRef('focused')
  const lastAlertReasonRef     = useRef('default')
  const adaptiveAlertMultRef   = useRef(1.0) // multiplier on alertDelayMs (adaptive fatigue)
  const alertsInFirst15Ref     = useRef(0)   // alerts fired in first 15 min
  const lastNoAlertCheckRef    = useRef(0)   // timestamp of last no-alert check
  const distractedSinceRef     = useRef(null)
  const lastGentleReminderRef  = useRef(0)
  const lastPhaseCueRef        = useRef(0)
  const preDriftRiskRef        = useRef({ active: false, level: 0, reason: 'stable' })
  const preDriftChargeMsRef    = useRef(0)
  const activityRef            = useRef(getLastActivity())
  const focusAppsConfigRef     = useRef(loadFocusAppsConfig())
  const sessionIntentRef       = useRef(sessionIntent)
  const activityClassCacheRef  = useRef(null)  // cross-frame memo of classifyGoalAwareActivity
  const activeDistractionAppRef = useRef(null)
  const activeDistractionSinceRef = useRef(null)
  const activeFocusAppRef       = useRef(null)
  const activityFocusBonusRef   = useRef(0)
  const activityDistractionPenaltyRef = useRef(0)
  const lastActivityScoreTickRef = useRef(null)
  const companionBlockingRef = useRef({ blockedApps: [], blockedDomains: [], strictMode: false, allowedApps: [] })
  const focusModeEnabledRef = useRef(focusModeEnabled)
  // Ref stays in sync with state via useEffect to avoid stale closure in handleFaceResults
  const gentleReminderEnabledRef = useRef(gentleReminderEnabled)

  // ── Session stats refs ────────────────────────────────────────────────────
  const focusedSecondsRef    = useRef(0)
  const distractionEventsRef = useRef(0)
  const preDriftEventsRef    = useRef(0)
  const preDriftSecondsRef   = useRef(0)
  const longestStreakRef     = useRef(0)
  const currentStreakRef     = useRef(0)
  const timelineSnapshotsRef = useRef([])
  const distractionLogRef    = useRef([]) // [{second, reason}]
  const activityAlignmentRef = useRef(emptyActivityAlignmentSummary())
  const goodStreakSecsRef    = useRef(0)   // unbroken seconds at/above the focused threshold
  const focusPhaseRef        = useRef('arrival')
  const focusPhaseSecondsRef = useRef({ arrival: 0, ramp: 0, lock_in: 0, fade: 0, recovery: 0, drift: 0 })
  const focusPhaseTransitionsRef = useRef([])
  const phaseInterventionRef = useRef({
    gentleReminders: 0,
    preDriftNudges: 0,
    alertsByPhase: {},
    log: [],
  })

  // ── Personal EAR baseline refs ───────────────────────────────────────────
  const earBaselineRef      = useRef(0.28) // fallback default
  const earCalibSamplesRef  = useRef([])
  // Personal iris neutral (looking-at-screen) baseline, learned during the
  // 20s calibration. Gaze offsets are measured relative to these, so the
  // "eyes off screen" signal is personal, not a generic guess.
  const irisHNeutralRef     = useRef(0)
  const irisVNeutralRef     = useRef(0)
  const irisCalibSamplesRef = useRef([]) // { h, v } while looking at the screen
  const lastRecalibTimeRef  = useRef(0)    // timestamp of last EAR re-calibration

  // ── Detection confidence ref ──────────────────────────────────────────────
  const confidenceRef       = useRef(0) // 0..1
  const gazeSignalRef       = useRef({ hasFace: false, pitchDeg: 0, yawSigned: 0 })

  // ── Flow state refs ───────────────────────────────────────────────────────
  const flowGoodSinceRef    = useRef(null) // when flow conditions first met
  const inFlowRef           = useRef(false)

  // ── 3-frame deadzone refs ─────────────────────────────────────────────────
  const headTurnLeftFramesRef  = useRef(0)
  const headTurnRightFramesRef = useRef(0)
  const headDownFramesRef      = useRef(0)
  const eyesOffFramesRef       = useRef(0)   // consecutive frames with eyes off-screen
  const eyesOffStartRef        = useRef(null)
  const lowConfSinceRef        = useRef(null)  // when confidence first dropped low (Stage 2 trust gating)

  // ── Ambient sound refs ────────────────────────────────────────────────────
  const ambientRef = useRef(null) // { source, gain }

  const progress = (totalSeconds - timeLeft) / totalSeconds

  // ── Ambient sound control ─────────────────────────────────────────────────
  const stopAmbient = useCallback(() => {
    if (ambientRef.current) {
      try { ambientRef.current.source.stop() } catch {}
      ambientRef.current = null
    }
  }, [])

  const startAmbient = useCallback((mode) => {
    stopAmbient()
    if (mode === 'off') return
    try {
      const ctx = getAudioCtx()
      if (ctx.state === 'suspended') ctx.resume()
      const { source, gain } = createAmbientSource(ctx, mode)
      source.start()
      ambientRef.current = { source, gain }
    } catch {}
  }, [stopAmbient])

  const cycleAmbient = useCallback(() => {
    setAmbientMode(prev => {
      const idx = AMBIENT_MODES.indexOf(prev)
      const next = AMBIENT_MODES[(idx + 1) % AMBIENT_MODES.length]
      startAmbient(next)
      try { localStorage.setItem('eudaimonia_ambient_pref', next) } catch {}
      return next
    })
  }, [startAmbient])

  // Keep ref in sync whenever state changes
  useEffect(() => {
    gentleReminderEnabledRef.current = gentleReminderEnabled
  }, [gentleReminderEnabled])

  useEffect(() => {
    focusModeEnabledRef.current = focusModeEnabled
  }, [focusModeEnabled])

  useEffect(() => {
    sessionIntentRef.current = sessionIntent
  }, [sessionIntent])

  useEffect(() => {
    timeLeftRef.current = timeLeft
  }, [timeLeft])

  const applyCompanionSession = useCallback((session) => {
    if (!session || session === true) return false
    if (session.sessionState === 'active' || session.sessionState === 'paused') {
      companionSessionHadActiveRef.current = true
    }
    setExtensionFallbackSession(false)

    if (sessionEndedRef.current) return true

    if (session.sessionState === 'paused' && !isPausedRef.current) {
      isPausedRef.current = true
      pausedAtRef.current = pausedAtRef.current || Date.now()
      setIsPaused(true)
    } else if (session.sessionState === 'active' && isPausedRef.current) {
      isPausedRef.current = false
      if (pausedAtRef.current) {
        pausedTotalRef.current += Date.now() - pausedAtRef.current
        pausedAtRef.current = null
      }
      setIsPaused(false)
    }
    return true
  }, [])

  // Rebuild the whole camera pipeline. macOS suspends the webcam when the lid
  // closes, which permanently ends the MediaStream track — MediaPipe keeps
  // requesting frames from a dead stream and never recovers on its own, so the
  // app appeared broken until it was fully restarted and re-permitted.
  const restartCamera = useCallback((manual = false) => {
    const now = Date.now()
    if (!manual && now - lastRecoverAtRef.current < CAMERA_RECOVER_MS) return
    lastRecoverAtRef.current = now
    cameraRecoverTriesRef.current = manual ? 0 : cameraRecoverTriesRef.current + 1
    // Give the new pipeline a fresh grace period before the stall check judges it.
    lastFrameAtRef.current = now
    if (manual) {
      cameraFaultRef.current = null
      setCameraFault(null)
    }
    setCameraEpoch(e => e + 1)
  }, [])

  // Waking from sleep (or refocusing the window) is the moment to rebuild.
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState !== 'visible') return
      if (sessionEndedRef.current) return
      const lastFrame = lastFrameAtRef.current
      if (lastFrame && Date.now() - lastFrame > CAMERA_RECOVER_MS) {
        cameraRecoverTriesRef.current = 0   // a fresh wake deserves fresh attempts
        restartCamera()
      }
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    return () => {
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
    }
  }, [restartCamera])

  const pushBlockingState = useCallback(async (active, sessionState = active ? 'active' : 'inactive') => {
    const endTs = active ? Date.now() + Math.max(0, timeLeftRef.current) * 1000 : 0
    if (active) lastActivePushAtRef.current = Date.now()
    const companionSession = await pushCompanionSession({
      active,
      endTs,
      sessionState,
      ...companionBlockingRef.current,
    })
    const companionOwnsSession = applyCompanionSession(companionSession)
    setExtensionFallbackSession(active && !companionOwnsSession, endTs)
    return companionSession
  }, [applyCompanionSession])

  const pauseSession = useCallback(async () => {
    if (sessionEndedRef.current || isPausedRef.current) return
    isPausedRef.current = true
    pausedAtRef.current = Date.now()
    setIsPaused(true)
    await pushBlockingState(false, 'paused')
  }, [pushBlockingState])

  const resumeSession = useCallback(async () => {
    if (sessionEndedRef.current || !isPausedRef.current) return
    isPausedRef.current = false
    if (pausedAtRef.current) {
      pausedTotalRef.current += Date.now() - pausedAtRef.current
      pausedAtRef.current = null
    }
    setIsPaused(false)
    await pushBlockingState(true, 'active')
  }, [pushBlockingState])

  useEffect(() => {
    const focusCfg = loadFocusAppsConfig()
    focusAppsConfigRef.current = focusCfg

    // Tell the Companion app (if running) to enforce blocking on its own:
    // distraction apps/domains get hidden/blocked; in strict mode every
    // non-browser app except the focus (allowed) apps is hidden.
    // Re-push every 30s as keepalive in case the companion restarts mid-session.
    const blockedApps = focusCfg?.distractionApps || []
    const blockedDomains = [...new Set([
      ...(focusCfg?.distractionDomains || []),
      ...blockedApps.flatMap((app) => getDomainsFromAppPreset(app)),
    ])]
    const strictMode = loadStrictMode()
    const allowedApps = focusCfg?.focusApps || []
    companionBlockingRef.current = { blockedApps, blockedDomains, strictMode, allowedApps }
    const pushBlocking = () => {
      if (!isPausedRef.current && !sessionEndedRef.current) pushBlockingState(true)
    }
    pushBlocking()
    const blockingInterval = setInterval(pushBlocking, 30_000)

    startActivityPolling((activity) => {
      activityRef.current = activity
      setActivityStatus(activity)
    })
    return () => {
      clearInterval(blockingInterval)
      stopActivityPolling()
      pushBlockingState(false, sessionEndedRef.current ? 'ended' : 'inactive')
    }
  }, [duration, pushBlockingState])

  const toggleGentleReminder = useCallback(() => {
    setGentleReminderEnabled(prev => {
      const next = !prev
      try { localStorage.setItem('eudaimonia_gentle_reminder_pref', next ? 'on' : 'off') } catch {}
      return next
    })
  }, [])

  // ── End session ───────────────────────────────────────────────────────────
  const endSession = useCallback((completed = false) => {
    if (sessionEndedRef.current) return
    sessionEndedRef.current = true
    setExtensionFallbackSession(false)
    pushBlockingState(false, 'ended')
    stopAmbient()
    // If currently paused, include the ongoing pause interval in the total
    const ongoingPause = pausedAtRef.current ? (Date.now() - pausedAtRef.current) : 0
    const actualSeconds = Math.round((Date.now() - startTimeRef.current - pausedTotalRef.current - ongoingPause) / 1000)
    const snapshots = timelineSnapshotsRef.current
    // A session whose camera never delivered usable frames has no measurement:
    // focusScoreRef is still sitting at its 68 default. Reporting that as a score
    // wrote a fabricated "68% focus" into history. Both consumers (HomeScreen,
    // HistoryDashboard) already treat null as "no score", so say nothing instead
    // of saying something false.
    const trackingFaulted = !!cameraFaultRef.current
    const hasMeasurement = snapshots.length > 0
    const avgFocusScore = hasMeasurement
      ? Math.round(snapshots.reduce((sum, s) => sum + (s.score || 0), 0) / snapshots.length)
      : (trackingFaulted ? null : Math.round(focusScoreRef.current))
    const focusPhaseSeconds = { ...focusPhaseSecondsRef.current }
    const dominantFocusPhase = Object.entries(focusPhaseSeconds)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || focusPhaseRef.current
    onEnd({
      plannedDuration:      duration,
      actualSeconds,
      completed,
      focusLostCount:       distractionEventsRef.current,
      distractionEvents:    distractionEventsRef.current,
      preDriftEvents:       preDriftEventsRef.current,
      preDriftSeconds:      preDriftSecondsRef.current,
      focusedSeconds:       focusedSecondsRef.current,
      longestFocusedStreak: longestStreakRef.current,
      peakFocusStreak:      longestStreakRef.current,
      avgFocusScore,
      finalScore:           (trackingFaulted && !hasMeasurement) ? null : Math.round(focusScoreRef.current),
      trackingFaulted,
      timeline:             timelineSnapshotsRef.current,
      distractionLog:       distractionLogRef.current,
      sessionIntent:        sessionIntentRef.current,
      activityAlignment:    {
        secondsByKind: { ...activityAlignmentRef.current.secondsByKind },
        byActivity: { ...activityAlignmentRef.current.byActivity },
        events: [...activityAlignmentRef.current.events],
      },
      phaseInterventions: {
        gentleReminders: phaseInterventionRef.current.gentleReminders,
        preDriftNudges: phaseInterventionRef.current.preDriftNudges,
        alertsByPhase: { ...phaseInterventionRef.current.alertsByPhase },
        log: [...phaseInterventionRef.current.log],
      },
      focusPhases: {
        seconds: focusPhaseSeconds,
        dominant: dominantFocusPhase,
        final: focusPhaseRef.current,
        transitions: [...focusPhaseTransitionsRef.current],
      },
    })
  }, [duration, onEnd, pushBlockingState, stopAmbient])

  useEffect(() => {
    const syncCompanionSession = async () => {
      const companionSession = await fetchCompanionSession()
      if (!companionSession || sessionEndedRef.current) return
      if (companionSession.sessionState === 'inactive' || companionSession.sessionState === 'ended') {
        // Only honour an end signal the companion produced AFTER our latest
        // "this session is active" push. Otherwise it's a stale echo — e.g. a
        // leftover state from a previous session, or our own teardown push
        // landing out of order (React's dev double-mount reproduces this
        // exactly: the first mount's cleanup pushes 'inactive', and the live
        // session then read it back and killed itself seconds after starting).
        // Re-assert instead of dying; a genuine end still arrives next tick.
        const signalTs = companionSession.sessionUpdatedTs || 0
        if (companionSessionHadActiveRef.current && signalTs > lastActivePushAtRef.current) {
          endSession(false)
        } else if (!sessionEndedRef.current) {
          pushBlockingState(true)
        }
        return
      }
      applyCompanionSession(companionSession)
    }

    syncCompanionSession()
    const interval = setInterval(syncCompanionSession, 3000)
    return () => clearInterval(interval)
  }, [applyCompanionSession, endSession, pushBlockingState])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e) => {
      if (sessionEndedRef.current) return
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === ' ' || e.key === 'p') {
        e.preventDefault()
        if (isPausedRef.current) resumeSession()
        else pauseSession()
      } else if (e.key === 'Escape') {
        endSession(false)
      } else if (e.key === 'h') {
        setCamHidden(h => !h)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [endSession, pauseSession, resumeSession])

  // ── Per-frame analysis ────────────────────────────────────────────────────
  const handleFaceResults = useCallback((results) => {
    // Frame heartbeat: proof that the camera pipeline is actually delivering.
    // Recorded before the pause/end guard so a paused session isn't judged stalled.
    lastFrameAtRef.current = Date.now()
    if (sessionEndedRef.current || isPausedRef.current) return

    const lmArray        = results.multiFaceLandmarks
    const hasFace        = lmArray?.length > 0
    const now            = Date.now()
    const sessionElapsed = (now - startTimeRef.current - pausedTotalRef.current) / 1000
    const calibrating    = sessionElapsed < CALIBRATION_SECS

    if (!hasFace) {
      if (!faceAbsentSinceRef.current) faceAbsentSinceRef.current = now
    } else {
      faceAbsentSinceRef.current = null
    }
    const faceAbsentMs = faceAbsentSinceRef.current ? now - faceAbsentSinceRef.current : 0

    // Early prompt: show "Looking away?" after 2s but before 4s penalty
    const shouldPrompt = faceAbsentMs >= 2000 && faceAbsentMs < FACE_ABSENT_HOLD_MS
    setFaceAbsentPrompt(shouldPrompt)

    let avgEar = 0.30, pitchDeg = 0, pitchUpDeg = 0, yawSigned = 0, mar = 0, irisV = 0, irisH = 0

    if (hasFace) {
      const f   = analyzeFrame(lmArray[0])
      avgEar    = f.avgEar
      pitchDeg  = f.pitchDeg
      pitchUpDeg = f.pitchUpDeg
      yawSigned = f.yawSigned
      mar       = f.mar
      irisV     = f.irisV
      irisH     = f.irisH

      // Computed personal EAR thresholds from baseline
      const earBlink = earBaselineRef.current * 0.72
      const earHeavy = earBaselineRef.current * 0.55

      if (avgEar < earBlink) {
        wasClosedRef.current = true
      } else if (wasClosedRef.current) {
        wasClosedRef.current = false
        blinkTimestampsRef.current.push(now)
      }
      perclosHistRef.current.push({ t: now, heavy: avgEar < earHeavy })
      nosePtHistRef.current.push({ t: now, x: f.nosePt.x, y: f.nosePt.y })
    }
    const adjustedYawSigned = yawSigned - yawNeutral
    gazeSignalRef.current = { hasFace, pitchDeg, yawSigned: adjustedYawSigned }

    const tenAgo   = now - BLINK_WIN_MS
    const thirtyAgo = now - PERCLOS_WIN_MS
    const driftAgo = now - HEAD_DRIFT_WIN_MS
    blinkTimestampsRef.current = blinkTimestampsRef.current.filter(t => t > tenAgo)
    perclosHistRef.current     = perclosHistRef.current.filter(f => f.t > thirtyAgo)
    nosePtHistRef.current      = nosePtHistRef.current.filter(p => p.t > driftAgo)

    const blinkRate    = blinkTimestampsRef.current.length * 3
    const hasBlinkData = sessionElapsed >= 15
    const pHist        = perclosHistRef.current
    const perclos      = pHist.length > 0 ? (pHist.filter(f => f.heavy).length / pHist.length) * 100 : 0
    const hasPerclos   = sessionElapsed >= 30 && pHist.length >= 15

    if (hasFace && avgEar < EAR_PROLONGED_CLOSE) {
      if (!eyesClosedSinceRef.current) eyesClosedSinceRef.current = now
    } else {
      eyesClosedSinceRef.current = null
    }
    const eyesClosedMs = eyesClosedSinceRef.current ? now - eyesClosedSinceRef.current : 0
    // Early microsleep warning: research shows >500ms slow closure = drowsiness signal
    // (PMC3836343: sleep-deprived pilots showed increased 500ms+ closures with performance errors)
    // earlyMicrosleepMs uses EAR_PROLONGED_CLOSE threshold (held below 0.18)
    // but a shorter time window than PROLONGED_CLOSE_MS to catch onset earlier
    const earlyMicrosleepMs = hasFace && avgEar < EAR_PROLONGED_CLOSE ? eyesClosedMs : 0

    if (hasFace && mar > MAR_YAWN) {
      if (!yawnStartRef.current) yawnStartRef.current = now
    } else {
      yawnStartRef.current = null
    }
    const yawnMs = yawnStartRef.current ? now - yawnStartRef.current : 0

    if (hasFace && pitchDeg >= PHONE_PITCH_THRESH) {
      if (!phoneStartRef.current) phoneStartRef.current = now
    } else {
      phoneStartRef.current = null
    }
    const phoneMs = phoneStartRef.current ? now - phoneStartRef.current : 0

    if (hasFace && pitchUpDeg >= pitchUpDT) {
      if (!lookingUpStartRef.current) lookingUpStartRef.current = now
    } else {
      lookingUpStartRef.current = null
    }
    const lookingUpMs = lookingUpStartRef.current ? now - lookingUpStartRef.current : 0

    // ── 3-frame deadzone: only start timers after 3 consecutive qualifying frames ──
    if (hasFace && pitchDeg >= pitchDT && pitchDeg < PHONE_PITCH_THRESH) {
      headDownFramesRef.current += 1
    } else {
      headDownFramesRef.current = 0
      headDownStartRef.current = null
    }
    if (hasFace && adjustedYawSigned >= yawLT) {
      headTurnLeftFramesRef.current += 1
    } else {
      headTurnLeftFramesRef.current = 0
      headTurnLeftStartRef.current = null
    }
    if (hasFace && -adjustedYawSigned >= yawRT) {
      headTurnRightFramesRef.current += 1
    } else {
      headTurnRightFramesRef.current = 0
      headTurnRightStartRef.current = null
    }

    let headDownSecs = 0
    if (headDownFramesRef.current >= 3) {
      if (!headDownStartRef.current) headDownStartRef.current = now
      headDownSecs = (now - headDownStartRef.current) / 1000
    }

    let headTurnLeftSecs = 0, headTurnRightSecs = 0
    if (headTurnLeftFramesRef.current >= 3) {
      if (!headTurnLeftStartRef.current) headTurnLeftStartRef.current = now
      headTurnLeftSecs = (now - headTurnLeftStartRef.current) / 1000
    }
    if (headTurnRightFramesRef.current >= 3) {
      if (!headTurnRightStartRef.current) headTurnRightStartRef.current = now
      headTurnRightSecs = (now - headTurnRightStartRef.current) / 1000
    }

    // ── Eyes-off-screen (horizontal eye gaze) deadzone ──────────────────────
    // Horizontal eyes-off gaze is evaluated a few lines below, once the monitor
    // context (productiveHorizontal / head-turn direction) is known — it has to be
    // direction-aware so a 2-monitor setup works correctly.

    const fidgetVariance = headVariance(nosePtHistRef.current)

    // ── Detection confidence + trust gate (Stage 2) ──────────────────────────
    // Computed BEFORE scoring so a poor signal can HOLD the score instead of
    // letting noisy landmarks fake a "distracted" drop. High: face present, EAR
    // sane, low jitter. Low: EAR degenerate (bad light / occlusion) AND jittery.
    let conf = 0
    if (hasFace) {
      conf += 0.5
      if (avgEar >= 0.15 && avgEar <= 0.45) conf += 0.3
      if (fidgetVariance <= HEAD_DRIFT_THRESH) conf += 0.2
    }
    confidenceRef.current = conf
    // Sustained low confidence (with a face, outside calibration) = tracking
    // uncertain. Debounced against flicker. When uncertain we freeze the score
    // and mute alerts rather than accusing the user of being distracted.
    if (hasFace && !calibrating && conf <= CONF_UNCERTAIN_MAX) {
      if (!lowConfSinceRef.current) lowConfSinceRef.current = now
    } else {
      lowConfSinceRef.current = null
    }
    const trackingUncertain = !!lowConfSinceRef.current &&
      (now - lowConfSinceRef.current) >= UNCERTAIN_HOLD_MS

    const eyesRolledUp   = hasFace && irisV > 0.25
    const downwardContext = hasFace
      ? classifyDownwardAttention(devices, pitchDeg, adjustedYawSigned)
      : { kind: 'none' }
    const horizontalContext = hasFace
      ? classifyHorizontalAttention(devices, adjustedYawSigned)
      : { kind: 'center' }
    const productiveDownward = downwardContext.kind === 'productive'
    const unknownPhoneDownward = downwardContext.kind === 'unknown_phone'
    const productiveHorizontal = horizontalContext.kind === 'productive_left' ||
      horizontalContext.kind === 'productive_right'
    const unknownHorizontal = horizontalContext.kind === 'unknown_horizontal'

    // Real 2D gaze: iris shifted past the personal neutral = eyes have left the
    // screen even with the head straight — the case head pose alone missed.
    // Direction-aware so 2-monitor setups work: looking AT a side monitor means
    // the eyes track the SAME way the head turned, so yawSigned and irisH share a
    // sign (mirror-independent — both are +x-ward displacements in the same image).
    // When facing a side monitor (productiveHorizontal), only eyes pulling the
    // OPPOSITE way — off that monitor — counts (the "head at right monitor, eyes
    // dart left" case). On a single/centred screen, either direction counts.
    // 3-frame deadzone + hold so a saccade never triggers it (R2); resets on face
    // absent via the else branch (R4).
    const adjustedIrisH = hasFace ? irisH - irisHNeutralRef.current : 0
    let eyesOffScreen = false
    if (hasFace) {
      if (productiveHorizontal) {
        // Facing a side monitor. yaw and iris use OPPOSITE mirror conventions here
        // (yaw+ = head to user's LEFT; iris+ = eyes to user's RIGHT — both confirmed
        // from live data), so eyes ON the faced monitor => yaw & iris have OPPOSITE
        // signs, and eyes wandering OFF it => SAME sign. Only "off" counts, so a
        // glance across the monitor you're facing never fires.
        eyesOffScreen = adjustedIrisH * adjustedYawSigned > 0 &&
          Math.abs(adjustedIrisH) >= IRIS_OFF_H
      } else {
        eyesOffScreen = Math.abs(adjustedIrisH) >= IRIS_OFF_H
      }
    }
    if (eyesOffScreen) {
      eyesOffFramesRef.current += 1
    } else {
      eyesOffFramesRef.current = 0
      eyesOffStartRef.current = null
    }
    let eyesOffSecs = 0
    if (eyesOffFramesRef.current >= 3) {
      if (!eyesOffStartRef.current) eyesOffStartRef.current = now
      eyesOffSecs = (now - eyesOffStartRef.current) / 1000
    }

    const activityConnected = isActivityConnected()
    // Memoized across frames: activityRef.current is only replaced with a new object
    // when the daemon reports a fresher tick (see activityReceiver.applyIfFresher),
    // so re-classify only when an input actually changes — not every frame.
    // classifyGoalAwareActivity does URL parsing + Set/loop work that ran ~15x/s.
    const activityCache = activityClassCacheRef.current
    let activityClassification
    if (
      activityCache &&
      activityCache.activity === activityRef.current &&
      activityCache.connected === activityConnected &&
      activityCache.intent === sessionIntentRef.current &&
      activityCache.config === focusAppsConfigRef.current
    ) {
      activityClassification = activityCache.result
    } else {
      activityClassification = classifyGoalAwareActivity(
        activityRef.current,
        focusAppsConfigRef.current,
        activityConnected,
        sessionIntentRef.current
      )
      activityClassCacheRef.current = {
        activity: activityRef.current,
        connected: activityConnected,
        intent: sessionIntentRef.current,
        config: focusAppsConfigRef.current,
        result: activityClassification,
      }
    }
    const activityScoringEnabled = focusModeEnabledRef.current
    const activityIsFocus = activityScoringEnabled &&
      (activityClassification.kind === 'aligned' || activityClassification.kind === 'supportive')
    const activityIsDistraction = activityScoringEnabled &&
      (activityClassification.kind === 'blocked' || activityClassification.kind === 'distraction')
    const activeActivityKey = activityClassification.domain ||
      activityClassification.app.toLowerCase() ||
      activityClassification.label

    if (activityIsFocus) {
      if (activeFocusAppRef.current !== activeActivityKey) {
        activeFocusAppRef.current = activeActivityKey
        activityFocusBonusRef.current = 0
      }
    } else {
      activeFocusAppRef.current = null
      activityFocusBonusRef.current = 0
    }

    if (activityIsDistraction) {
      if (activeDistractionAppRef.current !== activeActivityKey) {
        activeDistractionAppRef.current = activeActivityKey
        activeDistractionSinceRef.current = now
        activityDistractionPenaltyRef.current = 0
      } else if (!activeDistractionSinceRef.current) {
        activeDistractionSinceRef.current = now
      }
    } else {
      activeDistractionAppRef.current = null
      activeDistractionSinceRef.current = null
      activityDistractionPenaltyRef.current = 0
    }
    const activityDistractionMs = activeDistractionSinceRef.current
      ? now - activeDistractionSinceRef.current
      : 0
    const elapsedActivitySecs = Math.max(0, Math.floor((now - startTimeRef.current - pausedTotalRef.current) / 1000))
    const activityScoreTick = Math.floor(elapsedActivitySecs / SCORE_UPDATE_SECS)
    if (!activityScoringEnabled) {
      activeFocusAppRef.current = null
      activeDistractionAppRef.current = null
      activeDistractionSinceRef.current = null
      activityFocusBonusRef.current = 0
      activityDistractionPenaltyRef.current = 0
      lastActivityScoreTickRef.current = null
    } else if (lastActivityScoreTickRef.current !== activityScoreTick) {
      lastActivityScoreTickRef.current = activityScoreTick
      // Focus-app rewards accrue once per score tick and cap at +10 while the
      // classified focus app remains active; this is added on top of camera score.
      if (activityIsFocus) {
        activityFocusBonusRef.current = Math.min(
          ACTIVITY_FOCUS_BONUS_MAX,
          activityFocusBonusRef.current + ACTIVITY_FOCUS_BONUS_PER_TICK
        )
      }
      // Distraction penalties only begin after the 10s hold and stop/reset as
      // soon as the user leaves the distraction app.
      if (activityIsDistraction && activityDistractionMs >= ACTIVITY_DISTRACTION_HOLD_MS) {
        activityDistractionPenaltyRef.current = Math.min(
          ACTIVITY_DISTRACTION_PENALTY_MAX,
          activityDistractionPenaltyRef.current + ACTIVITY_DISTRACTION_PENALTY_PER_TICK
        )
      }
    }
    const activityPenalty = activityDistractionPenaltyRef.current
    const activityBonus = activityFocusBonusRef.current

    // Distraction-device glance must hold for DISTRACTION_DOWN_HOLD_MS before
    // it counts — a momentary downward glance shouldn't trigger the severe penalty
    if (downwardContext.kind === 'distraction') {
      if (!distractionDownStartRef.current) distractionDownStartRef.current = now
    } else {
      distractionDownStartRef.current = null
    }
    const distractionDownward = distractionDownStartRef.current
      ? (now - distractionDownStartRef.current) >= DISTRACTION_DOWN_HOLD_MS
      : false

    // During calibration: collect EAR + iris-neutral samples for personal
    // baselines, then return. The user is looking at the screen (where the
    // calibrating ring is), so their iris position now = "eyes on task" neutral.
    if (calibrating) {
      if (hasFace && avgEar > 0.20) {
        earCalibSamplesRef.current.push(avgEar)
        irisCalibSamplesRef.current.push({ h: irisH, v: irisV })
      }
      if (earCalibSamplesRef.current.length > 0) {
        const sum = earCalibSamplesRef.current.reduce((a, b) => a + b, 0)
        earBaselineRef.current = sum / earCalibSamplesRef.current.length
      }
      if (irisCalibSamplesRef.current.length > 0) {
        const s = irisCalibSamplesRef.current
        irisHNeutralRef.current = s.reduce((a, b) => a + b.h, 0) / s.length
        irisVNeutralRef.current = s.reduce((a, b) => a + b.v, 0) / s.length
      }
      focusScoreRef.current = 68
      return
    }

    // ── EAR drift compensation: re-calibrate baseline every 10 min ──────────
    // Eye muscles fatigue mid-session → EAR naturally drops ~5–8% over 30 min.
    // Without re-calibration, a tired-but-still-focused user gets false penalties.
    // We blend new open-eye samples (>0.20) into existing baseline at 20% weight.
    if (hasFace && avgEar > 0.20 && (now - lastRecalibTimeRef.current) >= EAR_RECALIB_INTERVAL) {
      earBaselineRef.current = earBaselineRef.current * 0.8 + avgEar * 0.2
      lastRecalibTimeRef.current = now
    }

    // ── Frame delta for sustained-focus ramp ────────────────────────────────
    const frameDelta = lastFrameTsRef.current ? Math.min(200, now - lastFrameTsRef.current) : 33
    lastFrameTsRef.current = now

    // ── Scoring: earned focus, not assumed ──────────────────────────────────
    // Scientific basis:
    //  • Base 68: face present = necessary but not sufficient for focus
    //  • Bonuses reward healthy signals (blink rate, head stability, work-zone gaze)
    //  • Sustained-focus ramp: up to +15 after ~2 min of continuous good focus
    //    (mirrors PERCLOS & cognitive-load research: focus must be sustained, not instant)
    //  • Camera stare (pitch ≈ 0) does NOT earn the work-zone bonus, max ~83 without ramp
    let score = hasFace ? 68 : 0
    let primaryReason = 'focused'

    if (faceAbsentMs >= FACE_ABSENT_HOLD_MS) {
      score = 0
      primaryReason = 'away'
      sustainedGoodMsRef.current = 0  // ramp resets when person is clearly away
      // Activity-based bonus/penalty accumulators must reset here too, otherwise
      // a distraction penalty built up while the user is away from the webcam
      // gets slapped on in full the instant they return.
      activeFocusAppRef.current = null
      activeDistractionAppRef.current = null
      activeDistractionSinceRef.current = null
      activityFocusBonusRef.current = 0
      activityDistractionPenaltyRef.current = 0
      preDriftChargeMsRef.current = 0
      if (preDriftRiskRef.current.active || preDriftRiskRef.current.level !== 0) {
        preDriftRiskRef.current = { active: false, level: 0, reason: 'stable' }
        setPreDriftRisk(preDriftRiskRef.current)
      }
    } else if (faceAbsentMs > 0 && faceAbsentMs < FACE_ABSENT_HOLD_MS) {
      score = focusScoreRef.current * 0.88
    } else if (hasFace) {
      // ── Positive signals ───────────────────────────────────────────────────
      // Blink rate science (Doughty 2001; ergonomics.org.uk; frontiersin 2023):
      //   • 12–20/min = optimal screen work rate → full bonus
      //   • 5–11/min = blink SUPPRESSION during deep cognitive focus — this is
      //     a POSITIVE signal of concentration, not fatigue. Brain inhibits blink
      //     reflex to prevent perceptual blackout during intense information intake.
      //     Do NOT penalize moderate suppression; small bonus for focus signal.
      //   • 8–28/min extended normal range → small bonus
      //   • <3/min = extreme suppression (likely fatigue or glazing, not focus) → penalized below
      if (hasBlinkData && blinkRate >= 12 && blinkRate <= 20) score += 7
      else if (hasBlinkData && blinkRate >= 5 && blinkRate < 12) score += 4  // focus suppression = good
      else if (hasBlinkData && blinkRate >= 8 && blinkRate <= 28) score += 3

      // Stable head position (not fidgeting)
      if (fidgetVariance <= HEAD_DRIFT_THRESH * 0.5) score += 5
      else if (fidgetVariance <= HEAD_DRIFT_THRESH) score += 2

      // Work-zone gaze: pitch range adapts to webcam height.
      // pitch ≈ 0 means staring at a top camera, but can be normal for low-angle cameras.
      if (pitchDeg >= workZonePitchMin && pitchDeg < workZonePitchMax) score += 5
      if (productiveDownward) score += 3
      // Secondary monitor gaze = same focus value as primary screen gaze.
      // A second monitor is a work tool, not a distraction — treat it identically.
      if (productiveHorizontal) score += 5

      // ── Penalties ─────────────────────────────────────────────────────────
      if ((phoneMs >= PHONE_HOLD_MS && !productiveDownward) || distractionDownward) {
        score -= 45
        primaryReason = 'phone'
      } else if (unknownPhoneDownward) {
        score -= 18
        if (primaryReason === 'focused') primaryReason = 'phone'
      }
      // Early microsleep signal (800ms): moderate penalty for drowsiness onset
      // Full prolonged penalty at 1500ms (confirmed microsleep territory)
      if (eyesClosedMs >= PROLONGED_CLOSE_MS) {
        score -= 35
        if (primaryReason === 'focused') primaryReason = 'prolonged'
      } else if (earlyMicrosleepMs >= EARLY_MICROSLEEP_MS) {
        // 800ms+ closure: significant drowsiness warning (PMC3836343)
        score -= 15
        if (primaryReason === 'focused') primaryReason = 'prolonged'
      }
      if (hasPerclos) {
        if (perclos > 15)     score -= 30
        else if (perclos > 8) score -= 15
      }
      if (yawnMs >= YAWN_HOLD_MS) {
        score -= 20
        if (primaryReason === 'focused') primaryReason = 'yawn'
      }
      if (lookingUpMs >= 3000 && pitchUpDT <= 15) {
        score -= 25
        if (primaryReason === 'focused') primaryReason = 'lookingup'
      }
      // Penalize only extreme blink suppression (<3/min) — not moderate focus suppression
      // and high blink rates (>35/min = likely agitation or eye irritation)
      if (hasBlinkData && blinkRate > 0 && (blinkRate < 3 || blinkRate > 35)) score -= 15
      if (pitchDeg >= pitchDT && headDownSecs >= HEAD_DOWN_HOLD) {
        if (productiveDownward) score -= 3
        else score -= 25
      } else if (pitchDeg >= pitchDT * 0.75) {
        if (productiveDownward) score -= 1
        else score -= 8
      }
      if (!productiveHorizontal) {
        // unknownHorizontal (|yaw| > 30 with no matching side screen) intentionally
        // falls through to the same threshold+hold logic below rather than a flat
        // penalty — otherwise it pre-empts the severe (-25) sustained-turn penalty,
        // capping ALL large head turns at -8 regardless of duration (dead-code bug:
        // with default yawLT=30, the >= yawLT severe check becomes unreachable
        // since anything past 30 was being diverted to the flat -8 branch first).
        if (adjustedYawSigned >= yawLT && headTurnLeftSecs >= HEAD_TURN_HOLD) score -= 25
        else if (adjustedYawSigned >= yawLT * 0.6) score -= 8
        if (-adjustedYawSigned >= yawRT && headTurnRightSecs >= HEAD_TURN_HOLD) score -= 25
        else if (-adjustedYawSigned >= yawRT * 0.6) score -= 8
      }
      // Eyes off the screen (horizontal gaze past neutral). The direction-aware
      // deadzone above already excludes looking AT a side monitor, so no
      // productiveHorizontal gate here — this now fires even in the 2-monitor case
      // when the eyes dart off the monitor being faced. Mild + debounced (gaze is
      // noisy). Reuses the 'lookingup' reason ("Eyes on the task").
      if (eyesOffSecs >= EYES_OFF_HOLD_SECS) {
        score -= 15
        if (primaryReason === 'focused') primaryReason = 'lookingup'
      }
      if (eyesRolledUp) score -= 15
    }

    score = Math.max(0, Math.min(85, score))  // raw capped at 85 — last 15 pts come from ramp

    // Activity scoring is additive to the existing camera-derived score. Apply
    // it after the raw camera cap so the capped +10 focus-app reward remains
    // visible, while distraction penalties still stack with other penalties.
    if (hasFace && activityPenalty) {
      score = Math.max(0, score - activityPenalty)
      if (activityDistractionMs >= ACTIVITY_REASON_HOLD_MS && primaryReason === 'focused') {
        primaryReason = 'distraction_app'
      }
    } else if (hasFace && activityBonus) {
      score = Math.min(100, score + activityBonus)
    }

    // ── Sustained-focus ramp (+0 to +15 over ~2 min) ──────────────────────
    // Attention Restoration Theory (Kaplan 1995; Mark et al. 2008):
    // After a distraction, directed attention recovers gradually — ~2 min to re-engage.
    // We model this by building the ramp at 40% speed for 2 min post-distraction,
    // then full speed once recovery window has passed.
    const msSinceDistraction = lastDistractionRef.current ? now - lastDistractionRef.current : Infinity
    const inRecovery = msSinceDistraction < RECOVERY_WINDOW_MS
    const rampRate = inRecovery ? 0.4 : 1.0  // 40% speed while recovering

    if (trackingUncertain) {
      // signal unreliable — neither earn nor burn the focus ramp
    } else if (score >= 72) {
      sustainedGoodMsRef.current = Math.min(120_000, sustainedGoodMsRef.current + frameDelta * rampRate)
    } else {
      sustainedGoodMsRef.current = Math.max(0, sustainedGoodMsRef.current - frameDelta * 3)
    }
    const rampBonus = (sustainedGoodMsRef.current / 120_000) * 15

    const rawFinal = Math.min(100, score + rampBonus)
    rawScoreRef.current = rawFinal
    const smoothed = rawFinal * 0.3 + focusScoreRef.current * 0.7
    // Trust gate: when tracking is uncertain, HOLD the last trusted score rather
    // than letting a noisy signal drag it down into a false "distracted".
    if (!trackingUncertain) {
      focusScoreRef.current = Math.max(0, Math.min(100, smoothed))
    }

    const newStatus   = focusScoreRef.current >= 65 ? 'focused' : focusScoreRef.current >= 38 ? 'distracted' : 'alert'
    // Trust gate: surface "signal weak" instead of a (held, possibly low) status
    // so the user knows it's the camera signal, not an accusation.
    const displayStatus = trackingUncertain ? 'uncertain' : newStatus
    const displayReason = (displayStatus === 'focused' || displayStatus === 'uncertain') ? 'focused' : primaryReason

    // ── Pre-drift risk: sustained early destabilization before full distraction ─
    // This never subtracts score. It accumulates only while weak or unstable
    // signals persist, then decays quickly when the user stabilizes or resets on hard loss.
    const earlyAwayGlance = faceAbsentMs >= 600 && faceAbsentMs < FACE_ABSENT_HOLD_MS
    const unstableHead = hasFace &&
      fidgetVariance > HEAD_DRIFT_THRESH &&
      fidgetVariance <= HEAD_DRIFT_THRESH * 2.2
    const softHeadTurn = hasFace && !productiveHorizontal && (
      (adjustedYawSigned >= yawLT * 0.6 && headTurnLeftFramesRef.current >= 3 && headTurnLeftSecs < HEAD_TURN_HOLD) ||
      (-adjustedYawSigned >= yawRT * 0.6 && headTurnRightFramesRef.current >= 3 && headTurnRightSecs < HEAD_TURN_HOLD)
    )
    const softHeadDown = hasFace && !productiveDownward &&
      pitchDeg >= pitchDT * 0.75 &&
      pitchDeg < pitchDT &&
      headDownFramesRef.current >= 3
    const weakFocus = hasFace && focusScoreRef.current >= 55 && focusScoreRef.current < 72 && primaryReason === 'focused'
    const preDriftSignals = [
      unstableHead && 'gaze instability',
      earlyAwayGlance && 'away glances',
      softHeadTurn && 'side glances',
      softHeadDown && 'posture drift',
      weakFocus && 'weak focus',
    ].filter(Boolean)
    const strongestPreDriftReason = preDriftSignals[0] || 'stable'
    const riskInput = preDriftSignals.length >= 2 || unstableHead || earlyAwayGlance

    if (newStatus === 'alert' || faceAbsentMs >= FACE_ABSENT_HOLD_MS) {
      preDriftChargeMsRef.current = 0
    } else if (trackingUncertain) {
      // Stage-2 trust gate: the gaze/head signals pre-drift reads are exactly
      // what's unreliable while the signal is weak. Hold the charge — don't
      // inflate it on camera noise, don't decay it either. Resumes on recovery.
    } else if (riskInput) {
      preDriftChargeMsRef.current = Math.min(PRE_DRIFT_MAX_MS, preDriftChargeMsRef.current + frameDelta)
    } else {
      preDriftChargeMsRef.current = Math.max(0, preDriftChargeMsRef.current - frameDelta * PRE_DRIFT_DECAY_MULT)
    }

    // Never surface/count pre-drift while tracking is uncertain: it would contradict
    // the "Signal weak" state and pollute the debrief's drift-risk stats.
    const preDriftActive = preDriftChargeMsRef.current >= PRE_DRIFT_HOLD_MS &&
      newStatus !== 'alert' && !trackingUncertain
    const preDriftLevel = Math.round((preDriftChargeMsRef.current / PRE_DRIFT_MAX_MS) * 100)
    const prevPreDriftActive = preDriftRiskRef.current.active
    const nextPreDriftRisk = {
      active: preDriftActive,
      level: preDriftLevel,
      reason: preDriftActive ? strongestPreDriftReason : 'stable',
    }
    if (
      nextPreDriftRisk.active !== preDriftRiskRef.current.active ||
      nextPreDriftRisk.reason !== preDriftRiskRef.current.reason ||
      Math.abs(nextPreDriftRisk.level - preDriftRiskRef.current.level) >= 5
    ) {
      preDriftRiskRef.current = nextPreDriftRisk
      setPreDriftRisk(nextPreDriftRisk)
    } else {
      preDriftRiskRef.current = nextPreDriftRisk
    }
    if (preDriftActive && !prevPreDriftActive) {
      preDriftEventsRef.current += 1
    }

    if (displayStatus !== attentionStatusRef.current || displayReason !== currentReasonRef.current) {
      attentionStatusRef.current = displayStatus
      currentReasonRef.current   = displayReason
      setAttentionStatus(displayStatus)
      setDistractReason(displayReason)
    }

    // ── Flow state detection ─────────────────────────────────────────────────
    // Conditions (science: Csikszentmihalyi 1990; fNIRS research on flow = stable gaze,
    // low head movement, suppressed blink rate, consistent task engagement):
    //   • Score ≥ 72 (good, not just OK)
    //   • Low head fidget (stable gaze)
    //   • No active distraction reason
    //   • Maintained for FLOW_STABLE_MS (90s)
    const flowConditions = !trackingUncertain &&
      focusScoreRef.current >= 72 &&
      fidgetVariance <= HEAD_DRIFT_THRESH * 0.5 &&
      primaryReason === 'focused'
    if (flowConditions) {
      if (!flowGoodSinceRef.current) flowGoodSinceRef.current = now
      const flowFor = now - flowGoodSinceRef.current
      if (flowFor >= FLOW_STABLE_MS && !inFlowRef.current) {
        inFlowRef.current = true
        setInFlowState(true)
      }
    } else {
      flowGoodSinceRef.current = null
      if (inFlowRef.current) {
        inFlowRef.current = false
        setInFlowState(false)
      }
    }

    // ── Circadian-adjusted alert delay ────────────────────────────────────
    const circFactor      = getCircadianFactor()
    const adjustedAlertMs = alertDelayMs * circFactor  // tired hours (< 1.0) → alert fires sooner
    const currentPhase = focusPhaseRef.current
    const phasePolicy = getPhasePolicy(currentPhase)

    // Score dipped below 55 = mark latest distraction timestamp (reset on each new dip)
    // This ensures the recovery ramp is measured from the MOST RECENT distraction,
    // not stuck on the first one from an hour ago.
    if (focusScoreRef.current < 55) {
      lastDistractionRef.current = now
    }

    const adaptedAlertMs = adjustedAlertMs * adaptiveAlertMultRef.current * phasePolicy.alertDelayMult

    if (
      preDriftActive &&
      phasePolicy.preDriftNudge &&
      gentleReminderEnabledRef.current &&
      !trackingUncertain &&
      !overlayActiveRef.current &&
      (now - lastPhaseCueRef.current) >= GENTLE_REMINDER_COOLDOWN_MS &&
      (now - lastGentleReminderRef.current) >= GENTLE_REMINDER_COOLDOWN_MS
    ) {
      const elapsedSecs = Math.round((now - startTimeRef.current - pausedTotalRef.current) / 1000)
      lastPhaseCueRef.current = now
      lastGentleReminderRef.current = now
      phaseInterventionRef.current.preDriftNudges += 1
      phaseInterventionRef.current.log.push({
        second: elapsedSecs,
        type: 'pre_drift_nudge',
        phase: currentPhase,
        reason: preDriftRiskRef.current.reason,
      })
      setPhaseCue({ msg: phasePolicy.cue, phase: currentPhase })
      setTimeout(() => {
        setPhaseCue(cue => cue?.phase === currentPhase && cue?.msg === phasePolicy.cue ? null : cue)
      }, 8000)
      playGentleReminderSound()
    }

    // ── Gentle reminder: earlier, optional nudge before the severe overlay ─
    if (newStatus !== 'focused') {
      if (!distractedSinceRef.current) distractedSinceRef.current = now
      const distractedFor = now - distractedSinceRef.current
      const gentleCooldownOk = (now - lastGentleReminderRef.current) >= GENTLE_REMINDER_COOLDOWN_MS
      const lowFor = scoreLowSinceRef.current ? now - scoreLowSinceRef.current : 0
      const severeAlertSoon = focusScoreRef.current < 40 &&
        scoreLowSinceRef.current &&
        (adaptedAlertMs - lowFor) <= GENTLE_REMINDER_SEVERE_BUFFER_MS

      if (
        gentleReminderEnabledRef.current &&
        !trackingUncertain &&
        distractedFor >= Math.max(5_000, phasePolicy.gentleDelayMs || GENTLE_REMINDER_DELAY_MS) &&
        gentleCooldownOk &&
        !overlayActiveRef.current &&
        !severeAlertSoon
      ) {
        const elapsedSecs = Math.round((now - startTimeRef.current - pausedTotalRef.current) / 1000)
        lastGentleReminderRef.current = now
        phaseInterventionRef.current.gentleReminders += 1
        phaseInterventionRef.current.log.push({
          second: elapsedSecs,
          type: 'gentle_reminder',
          phase: currentPhase,
          reason: primaryReason,
        })
        playGentleReminderSound()
      }
    } else {
      distractedSinceRef.current = null
    }

    if (focusScoreRef.current < 40) {
      if (!scoreLowSinceRef.current) scoreLowSinceRef.current = now
      const lowFor     = now - scoreLowSinceRef.current
      const cooldownOk = (now - lastAlertTimeRef.current) >= ALERT_COOLDOWN_MS

      if (lowFor >= adaptedAlertMs && !overlayActiveRef.current && cooldownOk && !trackingUncertain) {
        overlayActiveRef.current   = true
        lastAlertTimeRef.current   = now
        lastDistractionRef.current = now  // start recovery window
        lastGentleReminderRef.current = now
        distractedSinceRef.current = null
        lastAlertReasonRef.current = primaryReason
        distractionEventsRef.current += 1
        // Track alerts in first 15 min for adaptive threshold
        const elapsedMs = now - startTimeRef.current - pausedTotalRef.current
        if (elapsedMs < 15 * 60 * 1000) alertsInFirst15Ref.current += 1
        if (alertsInFirst15Ref.current >= 3 && adaptiveAlertMultRef.current < 1.5) {
          adaptiveAlertMultRef.current = Math.min(1.5, adaptiveAlertMultRef.current * 1.5)
        }
        const elapsedSecs = Math.round((now - startTimeRef.current - pausedTotalRef.current) / 1000)
        phaseInterventionRef.current.alertsByPhase[currentPhase] =
          (phaseInterventionRef.current.alertsByPhase[currentPhase] || 0) + 1
        phaseInterventionRef.current.log.push({
          second: elapsedSecs,
          type: 'alert',
          phase: currentPhase,
          reason: primaryReason,
        })
        distractionLogRef.current.push({ second: elapsedSecs, reason: primaryReason, phase: currentPhase })
        setAlertReason(primaryReason)
        setShowOverlay(true)
        playAlertSound()
      }
    } else {
      scoreLowSinceRef.current = null
      if (overlayActiveRef.current) {
        overlayActiveRef.current = false
        setShowOverlay(false)
      }
    }

    // ── Adaptive: no alerts in 30 min → increase sensitivity (decrease mult) ─
    {
      const sinceLastAlert = now - Math.max(lastAlertTimeRef.current, lastNoAlertCheckRef.current)
      if (sinceLastAlert >= 30 * 60 * 1000 && adaptiveAlertMultRef.current > 0.8) {
        adaptiveAlertMultRef.current = Math.max(0.8, adaptiveAlertMultRef.current * 0.8)
        lastNoAlertCheckRef.current  = now
      }
    }

    // (detection confidence + trust gate are computed earlier, before scoring)
  }, [alertDelayMs, devices, yawLT, yawRT, yawNeutral, pitchDT, pitchUpDT, workZonePitchMin, workZonePitchMax])

  // ── MediaPipe setup ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!videoRef.current) return
    // FaceMesh comes from a CDN (see index.html). If it's blocked (offline,
    // firewall, content blocker) this used to return silently and the session
    // ran on with a frozen default score — surface it instead. We no longer
    // need MediaPipe's camera_utils at all; we drive the camera ourselves.
    if (!window.FaceMesh) {
      cameraFaultRef.current = 'library'
      setCameraFault('library')
      return
    }
    const faceMesh = new window.FaceMesh({
      // Resolved against the document base so the same build works on Vercel and
      // inside the native app (vite base is './'). Local files, never a CDN.
      locateFile: (file) => new URL(`mediapipe/${file}`, document.baseURI).href,
    })
    faceMesh.setOptions({
      maxNumFaces: 1, refineLandmarks: true,
      minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
    })
    faceMesh.onResults(handleFaceResults)

    let cancelled = false
    const faultFor = (err) => {
      const name = err?.name || ''
      if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission'
      if (name === 'NotReadableError' || name === 'AbortError') return 'busy'
      if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no_camera'
      return 'permission'
    }
    const raiseFault = (err) => {
      if (cancelled) return
      const fault = faultFor(err)
      cameraFaultRef.current = fault
      setCameraFault(fault)
    }

    const camera = createCameraController(videoRef.current, {
      width: 320, height: 240,
      onFrame: () => {
        if (cancelled || !videoRef.current || sessionEndedRef.current) return
        return faceMesh.send({ image: videoRef.current })
      },
      // A track that ends or stays muted is dead for good (lid closed, camera
      // taken by another app, USB unplugged). Rebuild immediately rather than
      // waiting for the heartbeat to infer it seconds later.
      onTrackLost: () => { if (!cancelled) restartCamera() },
    })

    camera.start().catch(raiseFault)

    return () => {
      cancelled = true
      camera.stop()
      faceMesh.close?.()
    }
    // cameraEpoch is the restart trigger: bumping it tears this down and
    // rebuilds a fresh FaceMesh + camera against a live MediaStream.
  }, [handleFaceResults, cameraEpoch, restartCamera])

  // ── Countdown + per-second stats ──────────────────────────────────────────
  useEffect(() => {
    const tick = setInterval(() => {
      if (isPausedRef.current) return

      setTimeLeft((prev) => {
        if (prev <= 1) { clearInterval(tick); return 0 }
        return prev - 1
      })

      const now = Date.now()
      const elapsedSecs = Math.round((now - startTimeRef.current - pausedTotalRef.current) / 1000)
      const calibrating = elapsedSecs < CALIBRATION_SECS

      // ── Camera health ────────────────────────────────────────────────────
      // The scoring pipeline only runs from MediaPipe frames. If frames stop
      // (or never start), focusScoreRef stays frozen at its 68 default — and
      // because 68 >= 40 the loop below counted every second as "focused",
      // producing a fabricated ~100% session for a camera that was never on.
      // A frame heartbeat catches every cause at once: denied permission,
      // camera busy, unplugged mid-session, blocked CDN, MediaPipe crash.
      const lastFrame = lastFrameAtRef.current
      const frameGapMs = now - (lastFrame || startTimeRef.current)
      const healable = cameraFaultRef.current === 'stalled' || cameraFaultRef.current === 'no_frames'
      if (lastFrame && frameGapMs < CAMERA_RECOVER_MS) {
        cameraRecoverTriesRef.current = 0        // frames flowing — attempts reset
      }
      if (healable && lastFrame && frameGapMs < CAMERA_STALL_MS) {
        cameraFaultRef.current = null            // frames arrived — self-heal
        setCameraFault(null)
      } else if (
        !cameraFaultRef.current &&
        lastFrame &&                             // only once frames HAVE flowed (never mid cold-start)
        frameGapMs > CAMERA_RECOVER_MS &&
        cameraRecoverTriesRef.current < CAMERA_RECOVER_TRIES
      ) {
        restartCamera()                          // silent rebuild — the sleep/wake path
      } else if (!cameraFaultRef.current && frameGapMs > CAMERA_STALL_MS) {
        // Never received a single frame = tracking never started (e.g. the
        // MediaPipe model files failed to download); frames that stopped after
        // arriving = the feed dropped. Different causes, different advice.
        const fault = lastFrame ? 'stalled' : 'no_frames'
        cameraFaultRef.current = fault
        setCameraFault(fault)
      }
      if (cameraFaultRef.current) {
        // No trustworthy signal: never accumulate focus/streak/phase/timeline
        // stats. The timer above keeps running so the user can end the session.
        goodStreakSecsRef.current = 0        // don't let a streak survive a blackout (R4)
        if (currentStreakRef.current !== 0) {
          currentStreakRef.current = 0
          setCurrentStreak(0)
        }
        return
      }

      if (calibrating) {
        setIsCalibrating(true)
        setCalibProgress(Math.min(elapsedSecs / CALIBRATION_SECS, 1))
        return
      }
      setIsCalibrating(prev => {
        if (prev) {
          // Transition: show "Ready" for 1.5s
          setShowReady(true)
          setTimeout(() => setShowReady(false), 1500)
        }
        return false
      })
      setCalibProgress(1)

      const focused = focusScoreRef.current >= 40
      if (preDriftRiskRef.current.active) {
        preDriftSecondsRef.current += 1
      }

      if (focused) {
        focusedSecondsRef.current += 1
        currentStreakRef.current  += 1
        if (currentStreakRef.current > longestStreakRef.current)
          longestStreakRef.current = currentStreakRef.current
      } else {
        currentStreakRef.current = 0
      }

      const roundedScore = Math.round(focusScoreRef.current)
      const msSinceDistraction = lastDistractionRef.current ? now - lastDistractionRef.current : Infinity
      // Unbroken run at/above the 'focused' threshold — the phase driver.
      if (roundedScore >= 65) goodStreakSecsRef.current += 1
      else goodStreakSecsRef.current = 0
      const nextFocusPhase = classifyFocusPhase({
        elapsedSecs,
        score: roundedScore,
        goodStreakSecs: goodStreakSecsRef.current,
        msSinceDistraction,
        preDriftActive: preDriftRiskRef.current.active,
        inFlow: inFlowRef.current,
      })
      focusPhaseSecondsRef.current[nextFocusPhase] = (focusPhaseSecondsRef.current[nextFocusPhase] || 0) + 1
      if (nextFocusPhase !== focusPhaseRef.current) {
        focusPhaseTransitionsRef.current.push({
          second: elapsedSecs,
          from: focusPhaseRef.current,
          to: nextFocusPhase,
        })
        focusPhaseRef.current = nextFocusPhase
        setFocusPhase(nextFocusPhase)
      }
      setFocusScore(roundedScore)
      // Keep sparkline history (max 60 values, pushed once per second = last 60s)
      scoreHistoryRef.current = [...scoreHistoryRef.current, roundedScore].slice(-60)
      setScoreHistory(scoreHistoryRef.current)
      setCurrentStreak(currentStreakRef.current)
      setDistractionCount(distractionEventsRef.current)
      setDetectionConf(confidenceRef.current)
      // gaze dot: map yaw (-45..+45) and pitch (-30..+30) to 0..1
      const gazeSignal = gazeSignalRef.current
      if (gazeSignal.hasFace) {
        setGazePos({
          x: Math.max(0.05, Math.min(0.95, 0.5 - gazeSignal.yawSigned / 90)),
          y: Math.max(0.05, Math.min(0.95, 0.5 + gazeSignal.pitchDeg / 60)),
        })
      } else {
        setGazePos(null)
      }

      if (elapsedSecs > 0 && elapsedSecs % SCORE_UPDATE_SECS === 0) {
        // Reuse the classification already computed for scoring this frame.
        timelineSnapshotsRef.current.push({
          second: elapsedSecs,
          score: Math.round(focusScoreRef.current),
          focused,
          preDrift: preDriftRiskRef.current.active,
          phase: nextFocusPhase,
          activity: {
            kind: activityClassification.kind,
            label: activityClassification.label,
            basis: activityClassification.basis,
          },
        })
      }

      activityAlignmentRef.current = recordActivityAlignment(
        activityAlignmentRef.current,
        activityClassification,
        elapsedSecs
      )

      // Break reminders at 25min (1500s), 50min (3000s), 90min (5400s)
      const breakMins = [25, 50, 90]
      for (const min of breakMins) {
        const key = `break_${min}`
        if (elapsedSecs === min * 60) {
          setDismissedBreaks(prev => {
            if (prev.has(key)) return prev
            setBreakBanner({ msg: 'Consider a short break soon', id: key })
            setTimeout(() => {
              setBreakBanner(b => b?.id === key ? null : b)
            }, 15000)
            return prev
          })
        }
      }

      // Milestone celebrations at 5, 25, 50 min (only when focused)
      const milestones = [
        { secs: 5 * 60,  msg: '5 min in — nice start 🌱' },
        { secs: 25 * 60, msg: '25 min — great work 🔥' },
        { secs: 50 * 60, msg: '50 min — impressive focus ⚡' },
      ]
      for (const m of milestones) {
        if (elapsedSecs === m.secs && focusScoreRef.current >= 65) {
          setMilestone({ msg: m.msg })
          setTimeout(() => setMilestone(null), 3500)
          break
        }
      }
    }, 1000)
    return () => clearInterval(tick)
  }, [restartCamera])

  useEffect(() => {
    if (timeLeft === 0) endSession(true)
  }, [timeLeft, endSession])

  // ── Start ambient on mount if pref set ───────────────────────────────────
  useEffect(() => {
    if (ambientMode !== 'off') startAmbient(ambientMode)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally run once on mount

  // ── Cleanup ambient on unmount ────────────────────────────────────────────
  useEffect(() => () => stopAmbient(), [stopAmbient])

  // Keyboard hint: auto-hide after 5s, show again on keypress
  useEffect(() => {
    const timer = setTimeout(() => setHintVisible(false), 5000)
    const onKey = () => {
      setHintVisible(true)
      clearTimeout(timer)
      const t2 = setTimeout(() => setHintVisible(false), 5000)
      return () => clearTimeout(t2)
    }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey) }
  }, [])

  const overlayMsg = getPhaseAlertMessage(alertReason, focusPhase)
  const showStreak = !isCalibrating && currentStreak > 30
  const activityConnected = isActivityConnected()
  // Per-render memo (renders fire several times/sec from score updates); reclassify
  // only when the activity/intent actually changes.
  const activityClassification = useMemo(
    () => classifyGoalAwareActivity(activityStatus, focusAppsConfigRef.current, activityConnected, sessionIntent),
    [activityStatus, activityConnected, sessionIntent]
  )

  const dismissBreak = () => {
    if (breakBanner) {
      setDismissedBreaks(prev => new Set([...prev, breakBanner.id]))
      setBreakBanner(null)
    }
  }

  return (
    <div className="session-root">
      {/* Camera fault — tracking is not running, so say so instead of scoring nothing */}
      {cameraFault && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 60,
          background: 'rgba(13,15,20,0.94)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14,
          padding: 32, textAlign: 'center',
          backdropFilter: 'blur(3px)',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.22em', color: '#f97316', textTransform: 'uppercase' }}>
            Tracking paused
          </span>
          <p style={{ fontSize: 21, fontWeight: 500, color: '#f1f5f9', margin: 0, maxWidth: 460, lineHeight: 1.4 }}>
            {CAMERA_FAULT_COPY[cameraFault]?.title || CAMERA_FAULT_COPY.stalled.title}
          </p>
          <p style={{ fontSize: 14, color: '#94a3b8', margin: 0, maxWidth: 420, lineHeight: 1.6 }}>
            {CAMERA_FAULT_COPY[cameraFault]?.hint || CAMERA_FAULT_COPY.stalled.hint}
          </p>
          <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0', maxWidth: 420, lineHeight: 1.6 }}>
            Your focus score is on hold — this time won't be counted as focused.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button
              onClick={() => restartCamera(true)}
              style={{
                background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.45)',
                borderRadius: 100, padding: '10px 28px',
                fontSize: 14, fontWeight: 600, color: '#86efac', cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <button
              onClick={() => endSession(false)}
              style={{
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 100, padding: '10px 28px',
                fontSize: 14, fontWeight: 600, color: '#e2e8f0', cursor: 'pointer',
              }}
            >
              End session
            </button>
          </div>
        </div>
      )}
      {/* Pause overlay */}
      {isPaused && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 20,
          backdropFilter: 'blur(2px)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.2em', color: '#6b7280', textTransform: 'uppercase' }}>
            Paused
          </span>
          <button
            onClick={resumeSession}
            style={{
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 100, padding: '10px 28px',
              fontSize: 14, fontWeight: 600, color: '#e2e8f0', cursor: 'pointer',
              letterSpacing: '0.03em',
            }}
          >
            Resume
          </button>
          <span style={{ fontSize: 12, color: '#4b5563' }}>space to resume</span>
        </div>
      )}
      {window.innerWidth < 600 && (
        <div style={{
          position: 'fixed', inset: 0, background: '#0D0F14',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: 32, textAlign: 'center', zIndex: 999,
        }}>
          <p style={{ fontSize: 24, fontWeight: 300, color: '#ffffff', marginBottom: 12 }}>
            Desktop only
          </p>
          <p style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.6 }}>
            Focus tracking requires a webcam and a fixed screen setup.
            Please open Eudaimonia on your laptop or desktop.
          </p>
        </div>
      )}
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      {/* Milestone celebration pill */}
      {milestone && (
        <div style={{
          position: 'fixed', top: 40, left: '50%', transform: 'translateX(-50%)',
          zIndex: 25,
          background: 'linear-gradient(135deg, #1a3a2a 0%, #1e3a1e 100%)',
          border: '1px solid #2d6a4f',
          borderRadius: 100,
          padding: '8px 20px',
          display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: '0 2px 16px rgba(45,106,79,0.4)',
          fontSize: 13, fontWeight: 600, color: '#6ee7b7',
          animation: 'milestoneSlide 0.4s ease',
          pointerEvents: 'none',
        }}>
          {milestone.msg}
        </div>
      )}

      {/* Break reminder banner */}
      {breakBanner && !dismissedBreaks.has(breakBanner.id) && (
        <div style={{
          position: 'fixed', top: 40, left: '50%', transform: 'translateX(-50%)',
          zIndex: 20,
          background: '#1C1F28',
          border: '1px solid #2A2E3A',
          borderRadius: 100,
          padding: '7px 18px 7px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
          fontSize: 13, fontWeight: 500, color: '#94a3b8',
        }}>
          <span>{breakBanner.msg}</span>
          <button
            onClick={dismissBreak}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#6b7280', fontSize: 16, lineHeight: 1, padding: 0,
            }}
          >×</button>
        </div>
      )}

      {phaseCue && !showOverlay && (
        <div style={{
          position: 'fixed',
          top: breakBanner && !dismissedBreaks.has(breakBanner.id) ? 86 : 40,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 21,
          background: '#1C1F28',
          border: `1px solid ${(FOCUS_PHASES[phaseCue.phase]?.tone || '#fbbf24')}66`,
          borderRadius: 100,
          padding: '8px 18px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
          fontSize: 13,
          fontWeight: 700,
          color: FOCUS_PHASES[phaseCue.phase]?.tone || '#fbbf24',
          pointerEvents: 'none',
          animation: 'milestoneSlide 0.4s ease',
        }}>
          {phaseCue.msg}
        </div>
      )}

      <div style={{ position: 'fixed', top: 14, right: 20, zIndex: 15 }}>
        <StatusDot
          status={attentionStatus}
          score={focusScore}
          reason={distractReason}
          isCalibrating={isCalibrating}
          confidence={detectionConf}
          scoreHistory={scoreHistory}
        />
      </div>

      <div className="session-main">
        <p className="session-task">{task}</p>

        <FocusRing
          score={focusScore}
          timeLeft={timeLeft}
          isCalibrating={isCalibrating}
          isPaused={isPaused}
          calibProgress={calibProgress}
        />

        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', width: '100%' }}>
          <ActivityPill
            activity={activityStatus}
            classification={activityClassification}
            connected={activityConnected}
            activeSince={activeDistractionSinceRef.current}
            prominent
          />
        </div>

        {!isCalibrating && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            marginTop: 8,
          }}>
            <div style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: FOCUS_PHASES[focusPhase]?.tone || '#94a3b8',
              boxShadow: `0 0 0 3px ${(FOCUS_PHASES[focusPhase]?.tone || '#94a3b8')}22`,
            }} />
            <span style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 700, letterSpacing: '0.04em' }}>
              Phase: {FOCUS_PHASES[focusPhase]?.label || 'Arrival'}
            </span>
          </div>
        )}

        {/* Flow state indicator */}
        {inFlowState && !isCalibrating && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            marginTop: 8,
            animation: 'none',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%', background: '#a78bfa',
              boxShadow: '0 0 0 3px #a78bfa28',
              animation: 'flowPulse 2s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 12, color: '#a78bfa', fontWeight: 600, letterSpacing: '0.05em' }}>
              Flow state
            </span>
          </div>
        )}

        {preDriftRisk.active && !isCalibrating && !inFlowState && attentionStatus !== 'alert' && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            marginTop: 8,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%', background: '#f59e0b',
              boxShadow: '0 0 0 3px rgba(245,158,11,0.18)',
            }} />
            <span style={{ fontSize: 12, color: '#fbbf24', fontWeight: 700, letterSpacing: '0.04em' }}>
              Drift risk: {preDriftRisk.reason}
            </span>
          </div>
        )}

        {/* Streak counter */}
        {showStreak && !inFlowState && !preDriftRisk.active && (
          <p style={{
            fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 8, fontWeight: 500,
          }}>
            {formatTime(currentStreak)} streak
          </p>
        )}

        {/* Distraction event counter */}
        {!isCalibrating && distractionCount > 0 && (
          <p style={{
            fontSize: 11, color: '#64748b', textAlign: 'center', marginTop: 4,
          }}>
            {distractionCount} {distractionCount === 1 ? 'alert' : 'alerts'}
          </p>
        )}

        {isCalibrating && (
          <div style={{ textAlign: 'center', marginTop: 6 }}>
            <p style={{ fontSize: 12, color: '#94a3b8', letterSpacing: '0.05em', margin: 0 }}>
              Calibrating…
            </p>
            <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 0', fontStyle: 'italic' }}>
              Getting to know your eyes…
            </p>
          </div>
        )}
        {showReady && !isCalibrating && (
          <p style={{ fontSize: 13, color: '#22c55e', textAlign: 'center', marginTop: 6, fontWeight: 600, letterSpacing: '0.05em' }}>
            Ready ✓
          </p>
        )}

        {endConfirm ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
            <span style={{ fontSize: 13, color: '#94a3b8' }}>End session?</span>
            <button className="end-session-btn" style={{ padding: '6px 14px', fontSize: 13 }}
              onClick={() => { setEndConfirm(false); endSession(false) }}>Yes</button>
            <button className="end-session-btn" style={{ padding: '6px 14px', fontSize: 13, background: 'transparent', border: '1px solid #334155' }}
              onClick={() => setEndConfirm(false)}>Cancel</button>
          </div>
        ) : (
          <button className="end-session-btn" onClick={() => {
            setEndConfirm(true)
            setTimeout(() => setEndConfirm(false), 3000)
          }}>
            End session
          </button>
        )}

        {/* Keyboard hint */}
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 20,
          opacity: hintVisible ? 1 : 0,
          transition: 'opacity 0.5s ease',
          pointerEvents: 'none',
        }}>
          <span style={{
            background: 'rgba(0,0,0,0.55)', borderRadius: 100, padding: '5px 14px',
            fontSize: 11, color: '#fff', letterSpacing: '0.04em', fontWeight: 500,
          }}>
            space pause · esc end · h camera
          </span>
        </div>
      </div>

      {/* Audio controls */}
      <div style={{ position: 'fixed', bottom: 20, left: 20, zIndex: 15, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        <button
          onClick={cycleAmbient}
          aria-label={`Ambient sound: ${AMBIENT_LABELS[ambientMode]}`}
          style={{
            background: ambientMode === 'off' ? '#1C1F28' : '#1C2818',
            border: `1px solid ${ambientMode === 'off' ? '#2A2E3A' : '#22c55e40'}`,
            borderRadius: 100,
            padding: '6px 16px',
            fontSize: 12, fontWeight: 600,
            color: ambientMode === 'off' ? '#6b7280' : '#22c55e',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {AMBIENT_LABELS[ambientMode]}
        </button>
        <button
          onClick={toggleGentleReminder}
          aria-pressed={gentleReminderEnabled}
          aria-label={`Gentle reminder ${gentleReminderEnabled ? 'on' : 'off'}`}
          style={{
            background: gentleReminderEnabled ? '#1C2818' : '#1C1F28',
            border: `1px solid ${gentleReminderEnabled ? '#22c55e40' : '#2A2E3A'}`,
            borderRadius: 100,
            padding: '6px 16px',
            fontSize: 12, fontWeight: 600,
            color: gentleReminderEnabled ? '#22c55e' : '#6b7280',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Reminder {gentleReminderEnabled ? 'On' : 'Off'}
        </button>
      </div>

      <div className="webcam-corner">
        {faceAbsentPrompt && !isPaused && !isCalibrating && (
          <div style={{
            fontSize: 11, color: '#9ca3af', textAlign: 'center',
            marginBottom: 4, letterSpacing: '0.04em', fontWeight: 500,
            opacity: 0.8,
          }}>
            Looking away?
          </div>
        )}
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <video
            ref={videoRef}
            className="webcam-feed"
            onClick={() => !camHidden && setCamSize(s => s === 'full' ? 'mini' : 'full')}
            style={{
              opacity: camHidden ? 0 : 1,
              width: camHidden ? 0 : camSize === 'mini' ? 32 : 160,
              height: camHidden ? 0 : camSize === 'mini' ? 32 : 120,
              borderRadius: camSize === 'mini' ? '50%' : 8,
              marginBottom: camHidden ? 0 : undefined,
              transition: 'opacity 0.25s ease, width 0.25s ease, height 0.25s ease, border-radius 0.25s ease',
              display: 'block',
              cursor: camHidden ? 'default' : 'pointer',
              objectFit: 'cover',
            }}
            autoPlay muted playsInline
          />
          {!camHidden && camSize === 'full' && !isCalibrating && gazePos && (
            <svg
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <circle
                cx={gazePos.x * 100}
                cy={gazePos.y * 100}
                r="4"
                fill="none"
                stroke="rgba(255,255,255,0.6)"
                strokeWidth="1.5"
              />
              <line x1={gazePos.x * 100 - 7} y1={gazePos.y * 100} x2={gazePos.x * 100 + 7} y2={gazePos.y * 100} stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
              <line x1={gazePos.x * 100} y1={gazePos.y * 100 - 7} x2={gazePos.x * 100} y2={gazePos.y * 100 + 7} stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
            </svg>
          )}
        </div>
        <button className="cam-toggle" onClick={() => setCamHidden((h) => !h)} aria-label={camHidden ? 'Show webcam' : 'Hide webcam'}>
          {camHidden ? (
            <span style={{ fontSize: 14, lineHeight: 1 }}>👁</span>
          ) : 'Hide'}
        </button>
      </div>

      {showOverlay && (
        <div className="focus-overlay">
          <div className="focus-overlay-inner">
            {overlayMsg.icon && <OverlayIcon type={overlayMsg.icon} />}
            <p className="focus-overlay-text">{overlayMsg.text}</p>
            <p className="focus-overlay-sub">{overlayMsg.sub}</p>
            <button
              onClick={() => {
                overlayActiveRef.current = false
                lastAlertTimeRef.current = Date.now()
                setShowOverlay(false)
              }}
              style={{
                marginTop: 8,
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 100,
                padding: '8px 24px',
                fontSize: 13,
                fontWeight: 600,
                color: '#94a3b8',
                cursor: 'pointer',
                fontFamily: 'inherit',
                letterSpacing: '0.03em',
                transition: 'background 0.15s',
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
