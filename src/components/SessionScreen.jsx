import { useState, useEffect, useRef, useCallback } from 'react'

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
const EAR_BLINK           = 0.20
const EAR_HEAVY           = 0.15
const EAR_PROLONGED_CLOSE = 0.18
const PROLONGED_CLOSE_MS  = 1500
const MAR_YAWN            = 0.55
const YAWN_HOLD_MS        = 1500
const BLINK_WIN_MS        = 10_000
const PERCLOS_WIN_MS      = 60_000
const PITCH_NEUTRAL       = 0.50
const PITCH_UP_THRESH     = 15
const PHONE_PITCH_THRESH  = 38
const PHONE_HOLD_MS       = 4000
const HEAD_DOWN_HOLD      = 10
const HEAD_TURN_HOLD      = 5
const FACE_ABSENT_HOLD_MS = 2000
const HEAD_DRIFT_WIN_MS   = 3000
const HEAD_DRIFT_THRESH   = 0.035
const ALERT_COOLDOWN_MS   = 60_000
const SCORE_UPDATE_SECS   = 5
const CALIBRATION_SECS    = 20

// ── Alert messages ────────────────────────────────────────────────────────────
const ALERT_MESSAGES = {
  default:    { text: 'Hey — come back.',        sub: 'Your session is still running' },
  phone:      { text: 'Put the phone down.',     sub: 'Eyes back on the screen' },
  away:       { text: 'Where did you go?',       sub: 'Come back to your session' },
  yawn:       { text: 'Stay with it.',           sub: "You've got this" },
  lookingup:  { text: 'Eyes on the task.',       sub: 'Stop daydreaming' },
  prolonged:  { text: 'Wake up.',                sub: 'Your eyes have been closed' },
}

const SCREEN_DEVICES = new Set(['monitor', 'laptop', 'ipad'])

function computeThresholds(devices = []) {
  let yawLeft = 30, yawRight = 30, pitchDown = 20, pitchUp = 15
  let ignoreBelowPhone = false
  for (const d of devices) {
    const isScreen = SCREEN_DEVICES.has(d.type)
    const col = d.col ?? 0.5
    const row = d.row ?? 0.5
    if (isScreen && col < 0.35)  yawLeft   = Math.max(yawLeft,   55)
    if (isScreen && col > 0.65)  yawRight  = Math.max(yawRight,  55)
    if (isScreen && row > 0.6)   pitchUp   = Math.max(pitchUp,   28)
    if (isScreen && row < 0.3)   pitchDown = Math.max(pitchDown, 30)
    if (d.type === 'phone' && row < 0.3) ignoreBelowPhone = true
  }
  return { yawLeft, yawRight, pitchDown, pitchUp, ignoreBelowPhone }
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

// ── Ambient Sound Engine ──────────────────────────────────────────────────────
const AMBIENT_MODES = ['off', 'rain', 'white', 'brown']
const AMBIENT_LABELS = { off: '🔇 Off', rain: '🌧 Rain', white: '〰 White', brown: '▓ Brown' }

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

// ── Focus Ring (SVG) ──────────────────────────────────────────────────────────
function FocusRing({ score, timeLeft, isCalibrating, isPaused }) {
  const size   = 220
  const radius = 96
  const stroke = 9
  const circ   = 2 * Math.PI * radius
  const fill   = isCalibrating ? 1 : score / 100
  const offset = circ * (1 - fill)

  const color = isCalibrating
    ? '#94a3b8'
    : score >= 70 ? '#22c55e'
    : score >= 40 ? '#f97316'
    : '#ef4444'

  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      <svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0, filter: `drop-shadow(0 0 8px ${color}4D)` }}>
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
          className={isCalibrating ? 'ring--calibrating' : ''}
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.4s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 0,
      }}>
        {isPaused ? (
          <span style={{ fontSize: 20, fontWeight: 700, color: '#6b7280', letterSpacing: '0.05em' }}>PAUSED</span>
        ) : (
          <span className="timer" style={{ fontSize: 42, lineHeight: 1, color: '#ffffff', fontWeight: 200 }}>{formatTime(timeLeft)}</span>
        )}
      </div>
    </div>
  )
}

// ── Status dot ────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  focused:    { color: '#22c55e', label: 'Focused'    },
  distracted: { color: '#f97316', label: 'Distracted' },
  alert:      { color: '#ef4444', label: 'Alert'      },
  calibrating:{ color: '#94a3b8', label: 'Calibrating'},
}

function StatusDot({ status, score, reason, isCalibrating }) {
  const cfg = isCalibrating ? STATUS_CONFIG.calibrating : (STATUS_CONFIG[status] ?? STATUS_CONFIG.focused)
  const { color, label } = cfg
  const reasonLabel = (!isCalibrating && reason && reason !== 'default') ? reason : label
  return (
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
        {reasonLabel}
      </span>
      <span style={{ fontSize: 11, color: '#2A2E3A' }}>·</span>
      <span style={{ fontSize: 12, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums', transition: 'color 0.4s' }}>
        {isCalibrating ? '--' : score}
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
  const [isPaused,        setIsPaused]        = useState(false)
  const [isCalibrating,   setIsCalibrating]   = useState(true)
  const [currentStreak,   setCurrentStreak]   = useState(0)
  const [ambientMode,     setAmbientMode]     = useState('off')
  const [breakBanner,     setBreakBanner]     = useState(null) // {msg, id}
  const [dismissedBreaks, setDismissedBreaks] = useState(new Set())

  const videoRef        = useRef(null)
  const sessionEndedRef = useRef(false)
  const startTimeRef    = useRef(Date.now())
  const isPausedRef     = useRef(false)
  const pausedAtRef     = useRef(null) // timestamp when paused
  const pausedTotalRef  = useRef(0)    // total ms spent paused

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
  const lookingUpStartRef      = useRef(null)
  const faceAbsentSinceRef     = useRef(null)
  const nosePtHistRef          = useRef([])

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
  const distractionLogRef    = useRef([]) // [{second, reason}]

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
      return next
    })
  }, [startAmbient])

  // ── End session ───────────────────────────────────────────────────────────
  const endSession = useCallback((completed = false) => {
    if (sessionEndedRef.current) return
    sessionEndedRef.current = true
    stopAmbient()
    const actualSeconds = Math.round((Date.now() - startTimeRef.current - pausedTotalRef.current) / 1000)
    onEnd({
      plannedDuration:      duration,
      actualSeconds,
      completed,
      focusLostCount:       distractionEventsRef.current,
      distractionEvents:    distractionEventsRef.current,
      focusedSeconds:       focusedSecondsRef.current,
      longestFocusedStreak: longestStreakRef.current,
      timeline:             timelineSnapshotsRef.current,
      distractionLog:       distractionLogRef.current,
    })
  }, [duration, onEnd, stopAmbient])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e) => {
      if (sessionEndedRef.current) return
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === ' ' || e.key === 'p') {
        e.preventDefault()
        setIsPaused(prev => {
          const next = !prev
          isPausedRef.current = next
          if (next) {
            pausedAtRef.current = Date.now()
          } else {
            if (pausedAtRef.current) {
              pausedTotalRef.current += Date.now() - pausedAtRef.current
              pausedAtRef.current = null
            }
          }
          return next
        })
      } else if (e.key === 'Escape') {
        endSession(false)
      } else if (e.key === 'h') {
        setCamHidden(h => !h)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [endSession])

  // ── Per-frame analysis ────────────────────────────────────────────────────
  const handleFaceResults = useCallback((results) => {
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

    let avgEar = 0.30, pitchDeg = 0, pitchUpDeg = 0, yawSigned = 0, mar = 0, irisV = 0

    if (hasFace) {
      const f   = analyzeFrame(lmArray[0])
      avgEar    = f.avgEar
      pitchDeg  = f.pitchDeg
      pitchUpDeg = f.pitchUpDeg
      yawSigned = f.yawSigned
      mar       = f.mar
      irisV     = f.irisV

      if (avgEar < EAR_BLINK) {
        wasClosedRef.current = true
      } else if (wasClosedRef.current) {
        wasClosedRef.current = false
        blinkTimestampsRef.current.push(now)
      }
      perclosHistRef.current.push({ t: now, heavy: avgEar < EAR_HEAVY })
      nosePtHistRef.current.push({ t: now, x: f.nosePt.x, y: f.nosePt.y })
    }

    const tenAgo   = now - BLINK_WIN_MS
    const sixtyAgo = now - PERCLOS_WIN_MS
    const driftAgo = now - HEAD_DRIFT_WIN_MS
    blinkTimestampsRef.current = blinkTimestampsRef.current.filter(t => t > tenAgo)
    perclosHistRef.current     = perclosHistRef.current.filter(f => f.t > sixtyAgo)
    nosePtHistRef.current      = nosePtHistRef.current.filter(p => p.t > driftAgo)

    const blinkRate    = blinkTimestampsRef.current.length * 6
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

    let headDownSecs = 0
    if (hasFace && pitchDeg >= pitchDT && pitchDeg < PHONE_PITCH_THRESH) {
      if (!headDownStartRef.current) headDownStartRef.current = now
      headDownSecs = (now - headDownStartRef.current) / 1000
    } else {
      headDownStartRef.current = null
    }

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

    const fidgetVariance = headVariance(nosePtHistRef.current)
    const eyesRolledUp   = hasFace && irisV > 0.25

    // During calibration: don't compute penalties, score stays at 100
    if (calibrating) {
      focusScoreRef.current = 100
      return
    }

    let score = hasFace ? 100 : 0
    let primaryReason = 'focused'

    if (faceAbsentMs >= FACE_ABSENT_HOLD_MS) {
      score = 0
      primaryReason = 'away'
    } else if (hasFace) {
      const phonePenalty = ignoreBelowPhone ? 20 : 45
      if (phoneMs >= PHONE_HOLD_MS) { score -= phonePenalty; primaryReason = 'phone' }
      if (eyesClosedMs >= PROLONGED_CLOSE_MS) {
        score -= 35
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
      if (hasBlinkData && blinkRate > 0 && (blinkRate < 8 || blinkRate > 30)) score -= 15
      if (pitchDeg >= pitchDT && headDownSecs >= HEAD_DOWN_HOLD) score -= 25
      else if (pitchDeg >= pitchDT * 0.75) score -= 8
      if (yawSigned >= yawLT && headTurnLeftSecs >= HEAD_TURN_HOLD) score -= 25
      else if (yawSigned >= yawLT * 0.6) score -= 8
      if (-yawSigned >= yawRT && headTurnRightSecs >= HEAD_TURN_HOLD) score -= 25
      else if (-yawSigned >= yawRT * 0.6) score -= 8
      if (eyesRolledUp) score -= 15
      if (fidgetVariance > HEAD_DRIFT_THRESH) score -= 10
    }

    score = Math.max(0, score)
    focusScoreRef.current = score

    const newStatus   = score >= 70 ? 'focused' : score >= 40 ? 'distracted' : 'alert'
    const displayReason = newStatus === 'focused' ? 'focused' : primaryReason

    if (newStatus !== attentionStatusRef.current || displayReason !== currentReasonRef.current) {
      attentionStatusRef.current = newStatus
      currentReasonRef.current   = displayReason
      setAttentionStatus(newStatus)
      setDistractReason(displayReason)
    }

    if (score < 40) {
      if (!scoreLowSinceRef.current) scoreLowSinceRef.current = now
      const lowFor     = now - scoreLowSinceRef.current
      const cooldownOk = (now - lastAlertTimeRef.current) >= ALERT_COOLDOWN_MS

      if (lowFor >= alertDelayMs && !overlayActiveRef.current && cooldownOk) {
        overlayActiveRef.current   = true
        lastAlertTimeRef.current   = now
        lastAlertReasonRef.current = primaryReason
        distractionEventsRef.current += 1
        const elapsedSecs = Math.round((now - startTimeRef.current - pausedTotalRef.current) / 1000)
        distractionLogRef.current.push({ second: elapsedSecs, reason: primaryReason })
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
  }, [alertDelayMs, yawLT, yawRT, pitchDT, pitchUpDT, ignoreBelowPhone])

  // ── MediaPipe setup ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!videoRef.current || !window.FaceMesh || !window.Camera) return
    const faceMesh = new window.FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
    })
    faceMesh.setOptions({
      maxNumFaces: 1, refineLandmarks: true,
      minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
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
      if (isPausedRef.current) return

      setTimeLeft((prev) => {
        if (prev <= 1) { clearInterval(tick); return 0 }
        return prev - 1
      })

      const now = Date.now()
      const elapsedSecs = Math.round((now - startTimeRef.current - pausedTotalRef.current) / 1000)
      const calibrating = elapsedSecs < CALIBRATION_SECS

      if (calibrating) {
        setIsCalibrating(true)
        return
      }
      setIsCalibrating(false)

      const focused = focusScoreRef.current >= 40

      if (focused) {
        focusedSecondsRef.current += 1
        currentStreakRef.current  += 1
        if (currentStreakRef.current > longestStreakRef.current)
          longestStreakRef.current = currentStreakRef.current
      } else {
        currentStreakRef.current = 0
      }

      setFocusScore(Math.round(focusScoreRef.current))
      setCurrentStreak(currentStreakRef.current)

      if (elapsedSecs > 0 && elapsedSecs % SCORE_UPDATE_SECS === 0) {
        timelineSnapshotsRef.current.push({ second: elapsedSecs, focused })
      }

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
    }, 1000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    if (timeLeft === 0) endSession(true)
  }, [timeLeft, endSession])

  // ── Cleanup ambient on unmount ────────────────────────────────────────────
  useEffect(() => () => stopAmbient(), [stopAmbient])

  const overlayMsg = ALERT_MESSAGES[alertReason] ?? ALERT_MESSAGES.default
  const showStreak = !isCalibrating && currentStreak > 30

  const dismissBreak = () => {
    if (breakBanner) {
      setDismissedBreaks(prev => new Set([...prev, breakBanner.id]))
      setBreakBanner(null)
    }
  }

  return (
    <div className="session-root">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      {/* Break reminder banner */}
      {breakBanner && !dismissedBreaks.has(breakBanner.id) && (
        <div style={{
          position: 'fixed', top: 40, left: '50%', transform: 'translateX(-50%)',
          zIndex: 20,
          background: 'rgba(255,255,255,0.96)',
          border: '1px solid #f97316',
          borderRadius: 100,
          padding: '7px 18px 7px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 2px 12px rgba(249,115,22,0.15)',
          fontSize: 13, fontWeight: 500, color: '#7c3a1c',
        }}>
          <span>{breakBanner.msg}</span>
          <button
            onClick={dismissBreak}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#9ca3af', fontSize: 16, lineHeight: 1, padding: 0,
            }}
          >×</button>
        </div>
      )}

      <div style={{ position: 'fixed', top: 14, right: 20, zIndex: 15 }}>
        <StatusDot
          status={attentionStatus}
          score={focusScore}
          reason={distractReason}
          isCalibrating={isCalibrating}
        />
      </div>

      <div className="session-main">
        <p className="session-task">{task}</p>

        <FocusRing
          score={isCalibrating ? 100 : focusScore}
          timeLeft={timeLeft}
          isCalibrating={isCalibrating}
          isPaused={isPaused}
        />

        {/* Streak counter */}
        {showStreak && (
          <p style={{
            fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 8, fontWeight: 500,
          }}>
            {formatTime(currentStreak)} streak
          </p>
        )}

        {isCalibrating && (
          <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 6, letterSpacing: '0.05em' }}>
            Calibrating…
          </p>
        )}

        <button className="end-session-btn" onClick={() => endSession(false)}>
          End session
        </button>

        {/* Keyboard hint */}
        <p style={{
          fontSize: 11, color: '#2A2E3A', marginTop: 16, textAlign: 'center',
          letterSpacing: '0.03em',
        }}>
          space pause · esc end · h camera
        </p>
      </div>

      {/* Ambient sound button */}
      <div style={{ position: 'fixed', bottom: 20, left: 20, zIndex: 15 }}>
        <button
          onClick={cycleAmbient}
          style={{
            background: '#1C1F28',
            border: `1px solid ${ambientMode === 'off' ? '#2A2E3A' : '#22c55e40'}`,
            borderRadius: 100,
            padding: '6px 14px',
            fontSize: 12, fontWeight: 500,
            color: ambientMode === 'off' ? '#6B7280' : '#22c55e',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {AMBIENT_LABELS[ambientMode]}
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
