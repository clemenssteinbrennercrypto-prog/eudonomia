import { useState, useEffect, useRef, useCallback } from 'react'

// ── FaceMesh landmark indices ──────────────────────────────────────────────────
// Eyes (EAR: outer, upper-outer, upper-inner, inner, lower-inner, lower-outer)
const RIGHT_EYE   = [33,  160, 158, 133, 153, 144]
const LEFT_EYE    = [263, 387, 385, 362, 380, 373]
// Iris centres (refineLandmarks=true provides these)
const IRIS_R_CTR  = 468
const IRIS_L_CTR  = 473
// Head pose
const NOSE_TIP    = 1
const FOREHEAD    = 10
const CHIN        = 152
const EYE_L_OUT   = 33
const EYE_R_OUT   = 263
// Mouth (MAR: corners + upper/lower lip)
const MOUTH_L     = 61
const MOUTH_R     = 291
const MOUTH_TOP   = 13
const MOUTH_BOT   = 14
const MOUTH_T2    = 312   // inner upper-left
const MOUTH_B2    = 317   // inner lower-left

// ── Thresholds ────────────────────────────────────────────────────────────────
const EAR_BLINK           = 0.20   // eyes closed = blink
const EAR_HEAVY           = 0.15   // PERCLOS heavy-close
const EAR_PROLONGED_CLOSE = 0.18   // sustained close (not blinking)
const PROLONGED_CLOSE_MS  = 1500   // ms eyes must stay below threshold
const MAR_YAWN            = 0.55   // Mouth Aspect Ratio for yawn/gape
const YAWN_HOLD_MS        = 1500   // ms mouth must stay open
const BLINK_WIN_MS        = 10_000
const PERCLOS_WIN_MS      = 60_000
const PITCH_NEUTRAL       = 0.50
const PITCH_UP_THRESH     = 15     // deg — looking up at ceiling
const PHONE_PITCH_THRESH  = 38     // deg — strong downward tilt (phone candidate)
const PHONE_HOLD_MS       = 4000   // ms strong downward must hold to count as phone
const HEAD_DOWN_HOLD      = 10     // s for generic pitch-down penalty
const HEAD_TURN_HOLD      = 5      // s for yaw penalty
const FACE_ABSENT_HOLD_MS = 2000   // ms no face before penalising
const HEAD_DRIFT_WIN_MS   = 3000   // window for fidget detection
const HEAD_DRIFT_THRESH   = 0.035  // normalised landmark variance threshold
const ALERT_COOLDOWN_MS   = 60_000
const SCORE_UPDATE_SECS   = 5

// ── Alert messages keyed by reason ───────────────────────────────────────────
const ALERT_MESSAGES = {
  default:    { text: 'Hey — come back.',        sub: 'Your session is still running' },
  phone:      { text: 'Put the phone down.',     sub: 'Eyes back on the screen' },
  away:       { text: 'Where did you go?',       sub: 'Come back to your session' },
  yawn:       { text: 'Stay with it.',           sub: "You've got this" },
  lookingup:  { text: 'Eyes on the task.',       sub: 'Stop daydreaming' },
  prolonged:  { text: 'Wake up.',                sub: 'Your eyes have been closed' },
}

// Derive detection thresholds from the device layout.
// Devices with screens (monitor/laptop/ipad) in a direction → relax that threshold.
// Camera position → we know where tracking originates (future: calibration).
// Phone in 'below' → don't double-penalise normal desk posture.
const SCREEN_DEVICES = new Set(['monitor', 'laptop', 'ipad'])

// Zone IDs from IsometricWorkspace map to directions:
// back-left / mid-left → left,  back-right / mid-right → right
// back-* → far / behind (above in angular terms)
// front → below/close
// devices now have {type, col, row} from IsometricWorkspace
// col: 0=left, 1=right   row: 0=near/front, 1=far/back
function computeThresholds(devices = []) {
  let yawLeft = 30, yawRight = 30, pitchDown = 20, pitchUp = 15
  let ignoreBelowPhone = false

  for (const d of devices) {
    const isScreen = SCREEN_DEVICES.has(d.type)
    const col = d.col ?? 0.5
    const row = d.row ?? 0.5

    // Screen on left side → looking left is ok
    if (isScreen && col < 0.35)  yawLeft  = Math.max(yawLeft,  55)
    if (isScreen && col > 0.65)  yawRight = Math.max(yawRight, 55)
    // Screen far back → slight pitch up is ok
    if (isScreen && row > 0.6)   pitchUp  = Math.max(pitchUp,  28)
    // Screen close/front → slight pitch down is ok
    if (isScreen && row < 0.3)   pitchDown = Math.max(pitchDown, 30)

    // Phone in front zone → soften phone penalty
    if (d.type === 'phone' && row < 0.3) ignoreBelowPhone = true
  }

  return { yawLeft, yawRight, pitchDown, pitchUp, ignoreBelowPhone }
}

// ── Geometry ──────────────────────────────────────────────────────────────────
function dist2d(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

function eyeAspectRatio(lms, idx) {
  const [i1, i2, i3, i4, i5, i6] = idx
  return (dist2d(lms[i2], lms[i6]) + dist2d(lms[i3], lms[i5])) / (2 * dist2d(lms[i1], lms[i4]))
}

// Mouth Aspect Ratio — how wide open the mouth is (0 = closed, >0.55 = yawning)
function mouthAspectRatio(lms) {
  const w = dist2d(lms[MOUTH_L], lms[MOUTH_R])
  if (w < 0.01) return 0
  return (dist2d(lms[MOUTH_TOP], lms[MOUTH_BOT]) + dist2d(lms[MOUTH_T2], lms[MOUTH_B2])) / (2 * w)
}

// Vertical gaze via iris position relative to eyelid aperture.
// Returns a value: positive = looking up, negative = looking down (normalised)
function irisVerticalGaze(lms) {
  // Only works with refineLandmarks=true (iris landmarks 468-477 present)
  if (!lms[IRIS_R_CTR] || !lms[IRIS_L_CTR]) return 0
  // For each eye: compare iris centre Y to midpoint between upper/lower eyelid
  const rUpper = lms[160], rLower = lms[144], rIris = lms[IRIS_R_CTR]
  const lUpper = lms[387], lLower = lms[373], lIris = lms[IRIS_L_CTR]
  const rMid  = (rUpper.y + rLower.y) / 2
  const lMid  = (lUpper.y + lLower.y) / 2
  const rH    = Math.abs(rLower.y - rUpper.y)
  const lH    = Math.abs(lLower.y - lUpper.y)
  const rOff  = rH > 0.001 ? (rMid - rIris.y) / rH : 0  // positive = iris above midpoint = looking up
  const lOff  = lH > 0.001 ? (lMid - lIris.y) / lH : 0
  return (rOff + lOff) / 2
}

// Head fidget: variance of nose tip over last N frames
function headVariance(history) {
  if (history.length < 3) return 0
  const xs = history.map(p => p.x)
  const ys = history.map(p => p.y)
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  const vx = xs.reduce((a, b) => a + (b - mx) ** 2, 0) / xs.length
  const vy = ys.reduce((a, b) => a + (b - my) ** 2, 0) / ys.length
  return Math.sqrt(vx + vy)
}

// Full per-frame analysis — returns all signals
function analyzeFrame(lms) {
  const avgEar = (eyeAspectRatio(lms, RIGHT_EYE) + eyeAspectRatio(lms, LEFT_EYE)) / 2

  // Head pitch
  const nose = lms[NOSE_TIP], top = lms[FOREHEAD], chin = lms[CHIN]
  const faceH      = chin.y - top.y
  const lowerRatio = faceH > 0.01 ? (chin.y - nose.y) / faceH : PITCH_NEUTRAL

  // Pitch down (positive = head tilting down)
  const pitchDownSin = Math.min(1, Math.max(0, (PITCH_NEUTRAL - lowerRatio) * 2))
  const pitchDeg     = Math.asin(pitchDownSin) * (180 / Math.PI)

  // Pitch up (positive = head tilting up / looking at ceiling)
  const pitchUpSin = Math.min(1, Math.max(0, (lowerRatio - PITCH_NEUTRAL) * 2))
  const pitchUpDeg = Math.asin(pitchUpSin) * (180 / Math.PI)

  // Yaw
  const eL       = lms[EYE_L_OUT], eR = lms[EYE_R_OUT]
  const eyeW     = Math.abs(eR.x - eL.x)
  const midX     = (eL.x + eR.x) / 2
  const noseDelta = nose.x - midX
  const yawSin   = eyeW > 0.01 ? Math.min(1, Math.abs(noseDelta / eyeW) * 2) : 0
  const yawMag   = Math.asin(yawSin) * (180 / Math.PI)
  const yawSigned = yawMag * (noseDelta >= 0 ? 1 : -1)

  // Mouth
  const mar = mouthAspectRatio(lms)

  // Iris vertical gaze
  const irisV = irisVerticalGaze(lms)

  // Face scale (interocular distance as proxy for distance from camera)
  const faceScale = eyeW

  return { avgEar, pitchDeg, pitchUpDeg, yawSigned, mar, irisV, faceScale, nosePt: { x: nose.x, y: nose.y } }
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

function formatTime(s) {
  const m   = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// ── Status dot (now shows reason label too) ───────────────────────────────────
const STATUS_CONFIG = {
  focused:    { color: '#22c55e', label: 'Focused'    },
  distracted: { color: '#f97316', label: 'Distracted' },
  alert:      { color: '#ef4444', label: 'Alert'      },
}

function StatusDot({ status, score, reason }) {
  const { color, label } = STATUS_CONFIG[status] ?? STATUS_CONFIG.focused
  const reasonLabel = reason && reason !== 'default' ? reason : label
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 7,
      padding: '5px 12px',
      background: 'rgba(255,255,255,0.92)',
      border: '1px solid #e5e7eb',
      borderRadius: 100,
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
    }}>
      <div style={{
        width: 7, height: 7, borderRadius: '50%',
        background: color,
        boxShadow: `0 0 0 2.5px ${color}28`,
        flexShrink: 0,
        animation: status === 'alert' ? 'dotPulse 1.1s ease-in-out infinite' : 'none',
        transition: 'background 0.4s',
      }} />
      <span style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', letterSpacing: '0.01em', textTransform: 'capitalize' }}>
        {reasonLabel}
      </span>
      <span style={{ fontSize: 11, color: '#d1d5db' }}>·</span>
      <span style={{ fontSize: 12, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums', transition: 'color 0.4s' }}>
        {score}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SessionScreen({ task, duration, devices = [], onEnd }) {
  const totalSeconds = duration * 60
  const { yawLeft: yawLT, yawRight: yawRT, pitchDown: pitchDT, pitchUp: pitchUpDT, ignoreBelowPhone } = computeThresholds(devices)
  const alertDelayMs = devices.length >= 1 ? 120_000 : 90_000

  const [timeLeft,        setTimeLeft]        = useState(totalSeconds)
  const [showOverlay,     setShowOverlay]     = useState(false)
  const [alertReason,     setAlertReason]     = useState('default')
  const [attentionStatus, setAttentionStatus] = useState('focused')
  const [distractReason,  setDistractReason]  = useState('focused')
  const [focusScore,      setFocusScore]      = useState(100)
  const [camHidden,       setCamHidden]       = useState(false)

  const videoRef        = useRef(null)
  const sessionEndedRef = useRef(false)
  const startTimeRef    = useRef(Date.now())

  // ── Detection rolling buffers ─────────────────────────────────────────────
  const blinkTimestampsRef     = useRef([])
  const wasClosedRef           = useRef(false)
  const perclosHistRef         = useRef([])
  const headDownStartRef       = useRef(null)
  const headTurnLeftStartRef   = useRef(null)
  const headTurnRightStartRef  = useRef(null)
  const eyesClosedSinceRef     = useRef(null)   // for prolonged-close detection
  const yawnStartRef           = useRef(null)   // for yawn detection
  const phoneStartRef          = useRef(null)   // strong downward hold
  const lookingUpStartRef      = useRef(null)   // pitch up hold
  const faceAbsentSinceRef     = useRef(null)   // face absent timer
  const nosePtHistRef          = useRef([])     // [{t, x, y}] for fidget detection

  // ── Score & alert refs ────────────────────────────────────────────────────
  const focusScoreRef          = useRef(100)
  const scoreLowSinceRef       = useRef(null)
  const lastAlertTimeRef       = useRef(0)
  const overlayActiveRef       = useRef(false)
  const attentionStatusRef     = useRef('focused')
  const currentReasonRef       = useRef('focused')
  const lastAlertReasonRef     = useRef('default')

  // ── Session stats refs ────────────────────────────────────────────────────
  const focusedSecondsRef    = useRef(0)
  const distractionEventsRef = useRef(0)
  const longestStreakRef     = useRef(0)
  const currentStreakRef     = useRef(0)
  const timelineSnapshotsRef = useRef([])

  const progress = (totalSeconds - timeLeft) / totalSeconds

  // ── End session ───────────────────────────────────────────────────────────
  const endSession = useCallback((completed = false) => {
    if (sessionEndedRef.current) return
    sessionEndedRef.current = true
    const actualSeconds = Math.round((Date.now() - startTimeRef.current) / 1000)
    onEnd({
      plannedDuration:      duration,
      actualSeconds,
      completed,
      focusLostCount:       distractionEventsRef.current,
      distractionEvents:    distractionEventsRef.current,
      focusedSeconds:       focusedSecondsRef.current,
      longestFocusedStreak: longestStreakRef.current,
      timeline:             timelineSnapshotsRef.current,
    })
  }, [duration, onEnd])

  // ── Per-frame analysis ────────────────────────────────────────────────────
  const handleFaceResults = useCallback((results) => {
    if (sessionEndedRef.current) return

    const lmArray        = results.multiFaceLandmarks
    const hasFace        = lmArray?.length > 0
    const now            = Date.now()
    const sessionElapsed = (now - startTimeRef.current) / 1000

    // ── Face absent timer ─────────────────────────────────────────────────
    if (!hasFace) {
      if (!faceAbsentSinceRef.current) faceAbsentSinceRef.current = now
    } else {
      faceAbsentSinceRef.current = null
    }
    const faceAbsentMs = faceAbsentSinceRef.current ? now - faceAbsentSinceRef.current : 0

    // ── Extract all signals ───────────────────────────────────────────────
    let avgEar = 0.30, pitchDeg = 0, pitchUpDeg = 0, yawSigned = 0
    let mar = 0, irisV = 0

    if (hasFace) {
      const f   = analyzeFrame(lmArray[0])
      avgEar    = f.avgEar
      pitchDeg  = f.pitchDeg
      pitchUpDeg = f.pitchUpDeg
      yawSigned = f.yawSigned
      mar       = f.mar
      irisV     = f.irisV

      // Blink detection (rising edge)
      if (avgEar < EAR_BLINK) {
        wasClosedRef.current = true
      } else if (wasClosedRef.current) {
        wasClosedRef.current = false
        blinkTimestampsRef.current.push(now)
      }

      // PERCLOS accumulation
      perclosHistRef.current.push({ t: now, heavy: avgEar < EAR_HEAVY })

      // Nose position history for fidget detection
      nosePtHistRef.current.push({ t: now, x: f.nosePt.x, y: f.nosePt.y })
    }

    // Purge sliding windows
    const tenAgo   = now - BLINK_WIN_MS
    const sixtyAgo = now - PERCLOS_WIN_MS
    const driftAgo = now - HEAD_DRIFT_WIN_MS
    blinkTimestampsRef.current = blinkTimestampsRef.current.filter(t => t > tenAgo)
    perclosHistRef.current     = perclosHistRef.current.filter(f => f.t > sixtyAgo)
    nosePtHistRef.current      = nosePtHistRef.current.filter(p => p.t > driftAgo)

    // ── Blink rate ────────────────────────────────────────────────────────
    const blinkRate    = blinkTimestampsRef.current.length * 6
    const hasBlinkData = sessionElapsed >= 15

    // ── PERCLOS ───────────────────────────────────────────────────────────
    const pHist      = perclosHistRef.current
    const perclos    = pHist.length > 0 ? (pHist.filter(f => f.heavy).length / pHist.length) * 100 : 0
    const hasPerclos = sessionElapsed >= 30 && pHist.length >= 15

    // ── Prolonged eye close (dozed off, not blinking) ─────────────────────
    if (hasFace && avgEar < EAR_PROLONGED_CLOSE) {
      if (!eyesClosedSinceRef.current) eyesClosedSinceRef.current = now
    } else {
      eyesClosedSinceRef.current = null
    }
    const eyesClosedMs = eyesClosedSinceRef.current ? now - eyesClosedSinceRef.current : 0

    // ── Yawn / mouth open ─────────────────────────────────────────────────
    if (hasFace && mar > MAR_YAWN) {
      if (!yawnStartRef.current) yawnStartRef.current = now
    } else {
      yawnStartRef.current = null
    }
    const yawnMs = yawnStartRef.current ? now - yawnStartRef.current : 0

    // ── Phone detection (strong sustained downward pitch) ─────────────────
    if (hasFace && pitchDeg >= PHONE_PITCH_THRESH) {
      if (!phoneStartRef.current) phoneStartRef.current = now
    } else {
      phoneStartRef.current = null
    }
    const phoneMs = phoneStartRef.current ? now - phoneStartRef.current : 0

    // ── Looking up (at ceiling / daydreaming) ─────────────────────────────
    if (hasFace && pitchUpDeg >= pitchUpDT) {
      if (!lookingUpStartRef.current) lookingUpStartRef.current = now
    } else {
      lookingUpStartRef.current = null
    }
    const lookingUpMs = lookingUpStartRef.current ? now - lookingUpStartRef.current : 0

    // ── Generic head-down hold ────────────────────────────────────────────
    let headDownSecs = 0
    if (hasFace && pitchDeg >= pitchDT && pitchDeg < PHONE_PITCH_THRESH) {
      if (!headDownStartRef.current) headDownStartRef.current = now
      headDownSecs = (now - headDownStartRef.current) / 1000
    } else {
      headDownStartRef.current = null
    }

    // ── Head turn hold ────────────────────────────────────────────────────
    let headTurnLeftSecs = 0, headTurnRightSecs = 0
    if (hasFace && yawSigned >= yawLT) {
      if (!headTurnLeftStartRef.current) headTurnLeftStartRef.current = now
      headTurnLeftSecs = (now - headTurnLeftStartRef.current) / 1000
    } else {
      headTurnLeftStartRef.current = null
    }
    if (hasFace && -yawSigned >= yawRT) {
      if (!headTurnRightStartRef.current) headTurnRightStartRef.current = now
      headTurnRightSecs = (now - headTurnRightStartRef.current) / 1000
    } else {
      headTurnRightStartRef.current = null
    }

    // ── Head fidget (constant micro-movement = restless/distracted) ───────
    const fidgetVariance = headVariance(nosePtHistRef.current)

    // ── Iris gaze up (eyes rolled up = zoning out) ────────────────────────
    // irisV > 0.25 = iris noticeably above eye midpoint
    const eyesRolledUp = hasFace && irisV > 0.25

    // ── Compute focus score ───────────────────────────────────────────────
    let score = hasFace ? 100 : 0
    let primaryReason = 'focused'

    if (faceAbsentMs >= FACE_ABSENT_HOLD_MS) {
      score = 0
      primaryReason = 'away'
    } else if (hasFace) {

      // 1. Phone detection (strongest signal — clear intentional distraction)
      // If user declared a phone below their desk, soften the penalty
      const phonePenalty = ignoreBelowPhone ? 20 : 45
      if (phoneMs >= PHONE_HOLD_MS) {
        score -= phonePenalty
        primaryReason = 'phone'
      }

      // 2. Prolonged eyes closed (dozing)
      if (eyesClosedMs >= PROLONGED_CLOSE_MS) {
        score -= 35
        if (primaryReason === 'focused') primaryReason = 'prolonged'
      }

      // 3. PERCLOS (cumulative drowsiness)
      if (hasPerclos) {
        if (perclos > 15)     score -= 30
        else if (perclos > 8) score -= 15
      }

      // 4. Yawn (fatigue signal)
      if (yawnMs >= YAWN_HOLD_MS) {
        score -= 20
        if (primaryReason === 'focused') primaryReason = 'yawn'
      }

      // 5. Looking up (daydreaming / ceiling stare) — skip if screen above
      if (lookingUpMs >= 3000 && pitchUpDT <= 15) {
        score -= 25
        if (primaryReason === 'focused') primaryReason = 'lookingup'
      }

      // 6. Blink rate anomaly (stress or fatigue marker)
      if (hasBlinkData && blinkRate > 0 && (blinkRate < 8 || blinkRate > 30)) score -= 15

      // 7. Generic head pitch down (not phone level)
      if (pitchDeg >= pitchDT && headDownSecs >= HEAD_DOWN_HOLD) score -= 25
      else if (pitchDeg >= pitchDT * 0.75) score -= 8

      // 8. Head turn (looking away from screen)
      if (yawSigned >= yawLT && headTurnLeftSecs >= HEAD_TURN_HOLD) score -= 25
      else if (yawSigned >= yawLT * 0.6) score -= 8

      if (-yawSigned >= yawRT && headTurnRightSecs >= HEAD_TURN_HOLD) score -= 25
      else if (-yawSigned >= yawRT * 0.6) score -= 8

      // 9. Iris gaze up (eyes rolled upward)
      if (eyesRolledUp) score -= 15

      // 10. Head fidget (restlessness)
      if (fidgetVariance > HEAD_DRIFT_THRESH) score -= 10
    }

    score = Math.max(0, score)
    focusScoreRef.current = score

    // ── Attention status ──────────────────────────────────────────────────
    const newStatus = score >= 70 ? 'focused' : score >= 40 ? 'distracted' : 'alert'
    const displayReason = newStatus === 'focused' ? 'focused' : primaryReason

    if (newStatus !== attentionStatusRef.current || displayReason !== currentReasonRef.current) {
      attentionStatusRef.current = newStatus
      currentReasonRef.current   = displayReason
      setAttentionStatus(newStatus)
      setDistractReason(displayReason)
    }

    // ── Alert trigger ─────────────────────────────────────────────────────
    if (score < 40) {
      if (!scoreLowSinceRef.current) scoreLowSinceRef.current = now
      const lowFor     = now - scoreLowSinceRef.current
      const cooldownOk = (now - lastAlertTimeRef.current) >= ALERT_COOLDOWN_MS

      if (lowFor >= alertDelayMs && !overlayActiveRef.current && cooldownOk) {
        overlayActiveRef.current   = true
        lastAlertTimeRef.current   = now
        lastAlertReasonRef.current = primaryReason
        distractionEventsRef.current += 1
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
  }, [alertDelayMs, yawLT, yawRT, pitchDT])

  // ── MediaPipe setup ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!videoRef.current || !window.FaceMesh || !window.Camera) return

    const faceMesh = new window.FaceMesh({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
    })
    faceMesh.setOptions({
      maxNumFaces:            1,
      refineLandmarks:        true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence:  0.5,
    })
    faceMesh.onResults(handleFaceResults)

    const camera = new window.Camera(videoRef.current, {
      onFrame: async () => {
        if (videoRef.current && !sessionEndedRef.current) {
          await faceMesh.send({ image: videoRef.current })
        }
      },
      width: 320, height: 240,
    })
    camera.start()
    return () => { camera.stop(); faceMesh.close?.() }
  }, [handleFaceResults])

  // ── Countdown + per-second stats ──────────────────────────────────────────
  useEffect(() => {
    const tick = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) { clearInterval(tick); return 0 }
        return prev - 1
      })

      const elapsedSecs = Math.round((Date.now() - startTimeRef.current) / 1000)
      const focused     = focusScoreRef.current >= 40

      if (focused) {
        focusedSecondsRef.current += 1
        currentStreakRef.current  += 1
        if (currentStreakRef.current > longestStreakRef.current)
          longestStreakRef.current = currentStreakRef.current
      } else {
        currentStreakRef.current = 0
      }

      setFocusScore(Math.round(focusScoreRef.current))

      if (elapsedSecs > 0 && elapsedSecs % SCORE_UPDATE_SECS === 0) {
        timelineSnapshotsRef.current.push({ second: elapsedSecs, focused })
      }
    }, 1000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    if (timeLeft === 0) endSession(true)
  }, [timeLeft, endSession])

  // ── Overlay content ───────────────────────────────────────────────────────
  const overlayMsg = ALERT_MESSAGES[alertReason] ?? ALERT_MESSAGES.default

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="session-root">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      <div style={{ position: 'fixed', top: 14, right: 20, zIndex: 15 }}>
        <StatusDot status={attentionStatus} score={focusScore} reason={distractReason} />
      </div>

      <div className="session-main">
        <p className="session-task">{task}</p>
        <div className="timer">{formatTime(timeLeft)}</div>
        <button className="end-session-btn" onClick={() => endSession(false)}>
          End session
        </button>
      </div>

      <div className="webcam-corner">
        <video
          ref={videoRef}
          className="webcam-feed"
          style={{ opacity: camHidden ? 0 : 1 }}
          autoPlay muted playsInline
        />
        <button className="cam-toggle" onClick={() => setCamHidden((h) => !h)}>
          {camHidden ? 'Show camera' : 'Hide'}
        </button>
      </div>

      {showOverlay && (
        <div className="focus-overlay">
          <div className="focus-overlay-inner">
            <p className="focus-overlay-text">{overlayMsg.text}</p>
            <p className="focus-overlay-sub">{overlayMsg.sub}</p>
          </div>
        </div>
      )}
    </div>
  )
}
