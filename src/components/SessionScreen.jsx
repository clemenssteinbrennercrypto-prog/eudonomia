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
const HEAD_DOWN_HOLD      = 10
const HEAD_TURN_HOLD      = 5
const FACE_ABSENT_HOLD_MS = 4000
const HEAD_DRIFT_WIN_MS   = 3000
const HEAD_DRIFT_THRESH   = 0.035
const ALERT_COOLDOWN_MS      = 60_000
const SCORE_UPDATE_SECS      = 5
const CALIBRATION_SECS       = 20
const EAR_RECALIB_INTERVAL   = 600_000  // re-calibrate EAR baseline every 10 min
const FLOW_STABLE_MS         = 90_000   // 90s of good signals → flow state

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

const SCREEN_DEVICES = new Set(['monitor', 'laptop', 'ipad'])

function computeThresholds(devices = []) {
  // Science: ergonomic laptop posture = 15-20° downward head pitch is NORMAL (Stanford, Pitt).
  // Default pitchDown starts at 25° to avoid false-positives for laptop users.
  // Explicit laptop device bumps it further to 30° (user is definitely looking down at screen).
  let yawLeft = 30, yawRight = 30, pitchDown = 25, pitchUp = 15
  let ignoreBelowPhone = false
  const hasLaptop = devices.some(d => d.type === 'laptop')
  if (hasLaptop) pitchDown = 30  // laptop = 15-20° natural downward gaze, 30° is safe threshold
  for (const d of devices) {
    const isScreen = SCREEN_DEVICES.has(d.type)
    const col = d.col ?? 0.5
    const row = d.row ?? 0.5
    if (isScreen && col < 0.35)  yawLeft   = Math.max(yawLeft,   55)
    if (isScreen && col > 0.65)  yawRight  = Math.max(yawRight,  55)
    if (isScreen && row > 0.6)   pitchUp   = Math.max(pitchUp,   28)
    if (isScreen && row < 0.3)   pitchDown = Math.max(pitchDown, 35)
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

function StatusDot({ status, score, reason, isCalibrating, confidence = 0 }) {
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
  const [focusScore,      setFocusScore]      = useState(68)
  const [camHidden,       setCamHidden]       = useState(false)
  const [camSize,         setCamSize]         = useState('full') // 'full' | 'mini'
  const [isPaused,        setIsPaused]        = useState(false)
  const [isCalibrating,   setIsCalibrating]   = useState(true)
  const [calibProgress,   setCalibProgress]   = useState(0) // 0..1 during calibration
  const [showReady,       setShowReady]       = useState(false) // brief "Ready" flash
  const [currentStreak,   setCurrentStreak]   = useState(0)
  const [ambientMode,     setAmbientMode]     = useState('off')
  const [breakBanner,     setBreakBanner]     = useState(null) // {msg, id}
  const [dismissedBreaks, setDismissedBreaks] = useState(new Set())
  const [milestone,       setMilestone]       = useState(null) // {msg}
  const [inFlowState,     setInFlowState]     = useState(false)
  const [distractionCount, setDistractionCount] = useState(0)
  const [hintVisible,     setHintVisible]     = useState(true)
  const [endConfirm,      setEndConfirm]      = useState(false)
  const [faceAbsentPrompt, setFaceAbsentPrompt] = useState(false)
  const [gazePos,         setGazePos]         = useState(null) // {x, y} normalized 0..1
  const [detectionConf,   setDetectionConf]   = useState(0)   // 0..1 signal quality

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
  const focusScoreRef          = useRef(68)
  const rawScoreRef            = useRef(68)
  const scoreLowSinceRef       = useRef(null)
  const sustainedGoodMsRef     = useRef(0)   // ms of consecutive good focus (for ramp-up bonus)
  const lastFrameTsRef         = useRef(0)
  const lastAlertTimeRef       = useRef(0)
  const overlayActiveRef       = useRef(false)
  const attentionStatusRef     = useRef('focused')
  const currentReasonRef       = useRef('focused')
  const lastAlertReasonRef     = useRef('default')
  const adaptiveAlertMultRef   = useRef(1.0) // multiplier on alertDelayMs (adaptive fatigue)
  const alertsInFirst15Ref     = useRef(0)   // alerts fired in first 15 min
  const lastNoAlertCheckRef    = useRef(0)   // timestamp of last no-alert check

  // ── Session stats refs ────────────────────────────────────────────────────
  const focusedSecondsRef    = useRef(0)
  const distractionEventsRef = useRef(0)
  const longestStreakRef     = useRef(0)
  const currentStreakRef     = useRef(0)
  const timelineSnapshotsRef = useRef([])
  const distractionLogRef    = useRef([]) // [{second, reason}]

  // ── Personal EAR baseline refs ───────────────────────────────────────────
  const earBaselineRef      = useRef(0.28) // fallback default
  const earCalibSamplesRef  = useRef([])
  const lastRecalibTimeRef  = useRef(0)    // timestamp of last EAR re-calibration

  // ── Detection confidence ref ──────────────────────────────────────────────
  const confidenceRef       = useRef(0) // 0..1

  // ── Flow state refs ───────────────────────────────────────────────────────
  const flowGoodSinceRef    = useRef(null) // when flow conditions first met
  const inFlowRef           = useRef(false)

  // ── 3-frame deadzone refs ─────────────────────────────────────────────────
  const headTurnLeftFramesRef  = useRef(0)
  const headTurnRightFramesRef = useRef(0)
  const headDownFramesRef      = useRef(0)

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
    // If currently paused, include the ongoing pause interval in the total
    const ongoingPause = pausedAtRef.current ? (Date.now() - pausedAtRef.current) : 0
    const actualSeconds = Math.round((Date.now() - startTimeRef.current - pausedTotalRef.current - ongoingPause) / 1000)
    const snapshots = timelineSnapshotsRef.current
    const avgFocusScore = snapshots.length > 0
      ? Math.round(snapshots.reduce((sum, s) => sum + (s.score || 0), 0) / snapshots.length)
      : Math.round(focusScoreRef.current)
    onEnd({
      plannedDuration:      duration,
      actualSeconds,
      completed,
      focusLostCount:       distractionEventsRef.current,
      distractionEvents:    distractionEventsRef.current,
      focusedSeconds:       focusedSecondsRef.current,
      longestFocusedStreak: longestStreakRef.current,
      peakFocusStreak:      longestStreakRef.current,
      avgFocusScore,
      finalScore:           Math.round(focusScoreRef.current),
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

    // Early prompt: show "Looking away?" after 2s but before 4s penalty
    const shouldPrompt = faceAbsentMs >= 2000 && faceAbsentMs < FACE_ABSENT_HOLD_MS
    setFaceAbsentPrompt(shouldPrompt)

    let avgEar = 0.30, pitchDeg = 0, pitchUpDeg = 0, yawSigned = 0, mar = 0, irisV = 0

    if (hasFace) {
      const f   = analyzeFrame(lmArray[0])
      avgEar    = f.avgEar
      pitchDeg  = f.pitchDeg
      pitchUpDeg = f.pitchUpDeg
      yawSigned = f.yawSigned
      mar       = f.mar
      irisV     = f.irisV

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
    const earlyMicrosleepMs = eyesClosedMs

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
    if (hasFace && yawSigned >= yawLT) {
      headTurnLeftFramesRef.current += 1
    } else {
      headTurnLeftFramesRef.current = 0
      headTurnLeftStartRef.current = null
    }
    if (hasFace && -yawSigned >= yawRT) {
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

    const fidgetVariance = headVariance(nosePtHistRef.current)
    const eyesRolledUp   = hasFace && irisV > 0.25

    // During calibration: collect EAR samples for personal baseline, then return
    if (calibrating) {
      if (hasFace && avgEar > 0.20) {
        earCalibSamplesRef.current.push(avgEar)
      }
      if (earCalibSamplesRef.current.length > 0) {
        const sum = earCalibSamplesRef.current.reduce((a, b) => a + b, 0)
        earBaselineRef.current = sum / earCalibSamplesRef.current.length
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

      // Work-zone gaze: camera is at top of screen, so pitch 3–15° down = looking at screen
      // pitch ≈ 0 means staring at camera — not a focus signal
      if (pitchDeg >= 3 && pitchDeg < pitchDT * 0.7) score += 5

      // ── Penalties ─────────────────────────────────────────────────────────
      const phonePenalty = ignoreBelowPhone ? 20 : 45
      if (phoneMs >= PHONE_HOLD_MS) { score -= phonePenalty; primaryReason = 'phone' }
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
      if (pitchDeg >= pitchDT && headDownSecs >= HEAD_DOWN_HOLD) score -= 25
      else if (pitchDeg >= pitchDT * 0.75) score -= 8
      if (yawSigned >= yawLT && headTurnLeftSecs >= HEAD_TURN_HOLD) score -= 25
      else if (yawSigned >= yawLT * 0.6) score -= 8
      if (-yawSigned >= yawRT && headTurnRightSecs >= HEAD_TURN_HOLD) score -= 25
      else if (-yawSigned >= yawRT * 0.6) score -= 8
      if (eyesRolledUp) score -= 15
    }

    score = Math.max(0, Math.min(85, score))  // raw capped at 85 — last 15 pts come from ramp

    // ── Sustained-focus ramp (+0 to +15 over ~2 min) ──────────────────────
    if (score >= 72) {
      sustainedGoodMsRef.current = Math.min(120_000, sustainedGoodMsRef.current + frameDelta)
    } else {
      sustainedGoodMsRef.current = Math.max(0, sustainedGoodMsRef.current - frameDelta * 3)
    }
    const rampBonus = (sustainedGoodMsRef.current / 120_000) * 15

    const rawFinal = Math.min(100, score + rampBonus)
    rawScoreRef.current = rawFinal
    const smoothed = rawFinal * 0.3 + focusScoreRef.current * 0.7
    focusScoreRef.current = Math.max(0, Math.min(100, smoothed))

    const newStatus   = focusScoreRef.current >= 65 ? 'focused' : focusScoreRef.current >= 38 ? 'distracted' : 'alert'
    const displayReason = newStatus === 'focused' ? 'focused' : primaryReason

    if (newStatus !== attentionStatusRef.current || displayReason !== currentReasonRef.current) {
      attentionStatusRef.current = newStatus
      currentReasonRef.current   = displayReason
      setAttentionStatus(newStatus)
      setDistractReason(displayReason)
    }

    // ── Flow state detection ─────────────────────────────────────────────────
    // Conditions (science: Csikszentmihalyi 1990; fNIRS research on flow = stable gaze,
    // low head movement, suppressed blink rate, consistent task engagement):
    //   • Score ≥ 72 (good, not just OK)
    //   • Low head fidget (stable gaze)
    //   • No active distraction reason
    //   • Maintained for FLOW_STABLE_MS (90s)
    const flowConditions = focusScoreRef.current >= 72 &&
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
    const adjustedAlertMs = alertDelayMs / circFactor  // lenient hours → longer delay

    if (focusScoreRef.current < 40) {
      if (!scoreLowSinceRef.current) scoreLowSinceRef.current = now
      const lowFor     = now - scoreLowSinceRef.current
      const cooldownOk = (now - lastAlertTimeRef.current) >= ALERT_COOLDOWN_MS

      const adaptedAlertMs = adjustedAlertMs * adaptiveAlertMultRef.current
      if (lowFor >= adaptedAlertMs && !overlayActiveRef.current && cooldownOk) {
        overlayActiveRef.current   = true
        lastAlertTimeRef.current   = now
        lastAlertReasonRef.current = primaryReason
        distractionEventsRef.current += 1
        // Track alerts in first 15 min for adaptive threshold
        const elapsedMs = now - startTimeRef.current - pausedTotalRef.current
        if (elapsedMs < 15 * 60 * 1000) alertsInFirst15Ref.current += 1
        if (alertsInFirst15Ref.current >= 3 && adaptiveAlertMultRef.current < 1.5) {
          adaptiveAlertMultRef.current = Math.min(1.5, adaptiveAlertMultRef.current * 1.5)
        }
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

    // ── Adaptive: no alerts in 30 min → increase sensitivity (decrease mult) ─
    {
      const sinceLastAlert = now - Math.max(lastAlertTimeRef.current, lastNoAlertCheckRef.current)
      if (sinceLastAlert >= 30 * 60 * 1000 && adaptiveAlertMultRef.current > 0.8) {
        adaptiveAlertMultRef.current = Math.max(0.8, adaptiveAlertMultRef.current * 0.8)
        lastNoAlertCheckRef.current  = now
      }
    }

    // ── Detection confidence ───────────────────────────────────────────────
    // High confidence: face present, EAR in normal range, low head variance
    // Low confidence: no face, or EAR extreme (< 0.1 or > 0.5), or high variance
    let conf = 0
    if (hasFace) {
      conf += 0.5  // face present
      const earOk = avgEar >= 0.15 && avgEar <= 0.45
      if (earOk) conf += 0.3
      if (fidgetVariance <= HEAD_DRIFT_THRESH) conf += 0.2
    }
    confidenceRef.current = conf
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
    let lastFrameTime = 0
    const camera = new window.Camera(videoRef.current, {
      onFrame: async () => {
        const now = Date.now()
        if (now - lastFrameTime < 67) return // ~15fps cap
        lastFrameTime = now
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
      setDistractionCount(distractionEventsRef.current)
      setDetectionConf(confidenceRef.current)
      // gaze dot: map yaw (-45..+45) and pitch (-30..+30) to 0..1
      if (hasFace) {
        setGazePos({
          x: Math.max(0.05, Math.min(0.95, 0.5 - yawSigned / 90)),
          y: Math.max(0.05, Math.min(0.95, 0.5 + pitchDeg / 60)),
        })
      } else {
        setGazePos(null)
      }

      if (elapsedSecs > 0 && elapsedSecs % SCORE_UPDATE_SECS === 0) {
        timelineSnapshotsRef.current.push({ second: elapsedSecs, score: Math.round(focusScoreRef.current), focused })
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
  }, [])

  useEffect(() => {
    if (timeLeft === 0) endSession(true)
  }, [timeLeft, endSession])

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
            onClick={() => {
              isPausedRef.current = false
              if (pausedAtRef.current) {
                pausedTotalRef.current += Date.now() - pausedAtRef.current
                pausedAtRef.current = null
              }
              setIsPaused(false)
            }}
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

      <div style={{ position: 'fixed', top: 14, right: 20, zIndex: 15 }}>
        <StatusDot
          status={attentionStatus}
          score={focusScore}
          reason={distractReason}
          isCalibrating={isCalibrating}
          confidence={detectionConf}
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

        {/* Streak counter */}
        {showStreak && !inFlowState && (
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

      {/* Ambient sound button */}
      <div style={{ position: 'fixed', bottom: 20, left: 20, zIndex: 15 }}>
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
