import { useState, useEffect, useRef, useCallback } from 'react'

// ── FaceMesh landmark indices ──────────────────────────────────────────────────
// EAR: p1=outer, p2=upper-outer, p3=upper-inner, p4=inner, p5=lower-inner, p6=lower-outer
const RIGHT_EYE = [33,  160, 158, 133, 153, 144]
const LEFT_EYE  = [263, 387, 385, 362, 380, 373]
const NOSE_TIP  = 1
const FOREHEAD  = 10
const CHIN      = 152
const EYE_L_OUT = 33
const EYE_R_OUT = 263

// ── Scientific thresholds ────────────────────────────────────────────────────
const EAR_BLINK        = 0.20   // eyes closed during blink
const EAR_HEAVY        = 0.15   // 80%+ closed (PERCLOS)
const BLINK_WIN_MS     = 10_000 // sliding window for blink rate
const PERCLOS_WIN_MS   = 60_000 // PERCLOS window
const PITCH_NEUTRAL    = 0.50   // lowerRatio at neutral pitch
const HEAD_DOWN_HOLD   = 10     // seconds head must stay down before full penalty
const HEAD_TURN_HOLD   = 5      // seconds head must stay turned before full penalty
const ALERT_COOLDOWN_MS = 60_000
const SCORE_UPDATE_SECS = 5

// Per-direction yaw/pitch thresholds derived from monitor positions.
// positive yawSigned = person looking LEFT; negative = looking RIGHT.
// Monitor 'left'  → generous left threshold (55°)
// Monitor 'right' → generous right threshold (55°)
// Monitor 'below' → generous pitch-down threshold (25° instead of 20°)
// Monitor 'above' → pitch-up is not penalised regardless, no change needed
function computeThresholds(positions) {
  let yawLeft = 30, yawRight = 30, pitchDown = 20
  for (const p of positions) {
    if (p === 'left')  yawLeft   = 55
    if (p === 'right') yawRight  = 55
    if (p === 'below') pitchDown = 25
  }
  return { yawLeft, yawRight, pitchDown }
}

// ── Geometry ─────────────────────────────────────────────────────────────────
function dist2d(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

function eyeAspectRatio(lms, idx) {
  const [i1, i2, i3, i4, i5, i6] = idx
  return (dist2d(lms[i2], lms[i6]) + dist2d(lms[i3], lms[i5])) / (2 * dist2d(lms[i1], lms[i4]))
}

// Returns avgEar, pitchDeg (positive = head down), yawSigned (positive = looking LEFT)
// Direction convention: in the raw (un-mirrored) camera frame, the person's left side
// appears on the right of the image, so nose.x - midEyeX > 0 means they turned LEFT.
function analyzeFrame(lms) {
  const avgEar = (eyeAspectRatio(lms, RIGHT_EYE) + eyeAspectRatio(lms, LEFT_EYE)) / 2

  // Pitch: chin.y compresses toward nose.y as head tilts forward/down
  const nose = lms[NOSE_TIP], top = lms[FOREHEAD], chin = lms[CHIN]
  const faceH      = chin.y - top.y
  const lowerRatio = faceH > 0.01 ? (chin.y - nose.y) / faceH : PITCH_NEUTRAL
  const pitchSin   = Math.min(1, Math.max(0, (PITCH_NEUTRAL - lowerRatio) * 2))
  const pitchDeg   = Math.asin(pitchSin) * (180 / Math.PI)

  // Yaw: signed nose offset from eye midpoint
  const eL       = lms[EYE_L_OUT], eR = lms[EYE_R_OUT]
  const eyeW     = Math.abs(eR.x - eL.x)
  const midX     = (eL.x + eR.x) / 2
  const noseDelta = nose.x - midX                         // positive = looking LEFT
  const yawSin   = eyeW > 0.01 ? Math.min(1, Math.abs(noseDelta / eyeW) * 2) : 0
  const yawMag   = Math.asin(yawSin) * (180 / Math.PI)
  const yawSigned = yawMag * (noseDelta >= 0 ? 1 : -1)   // preserve direction

  return { avgEar, pitchDeg, yawSigned }
}

// ── Web Audio soft chime ──────────────────────────────────────────────────────
function playAlertSound() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    // 440 Hz → 330 Hz, gentle fade in then out
    osc.frequency.setValueAtTime(440, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(330, ctx.currentTime + 1.5)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.2)
    gain.gain.setValueAtTime(0.15, ctx.currentTime + 1.0)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.5)
    osc.start()
    osc.stop(ctx.currentTime + 2.5)
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(s) {
  const m   = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// ── Status dot ────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  focused:    { color: '#22c55e', label: 'Focused'    },
  distracted: { color: '#f97316', label: 'Distracted' },
  alert:      { color: '#ef4444', label: 'Alert'      },
}

function StatusDot({ status, score }) {
  const { color, label } = STATUS_CONFIG[status] ?? STATUS_CONFIG.focused
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
        transition: 'background 0.4s, box-shadow 0.4s',
        flexShrink: 0,
        animation: status === 'alert' ? 'dotPulse 1.1s ease-in-out infinite' : 'none',
      }} />
      <span style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', letterSpacing: '0.01em' }}>
        {label}
      </span>
      <span style={{ fontSize: 11, color: '#d1d5db' }}>·</span>
      <span style={{
        fontSize: 12, fontWeight: 600,
        color: color,
        fontVariantNumeric: 'tabular-nums',
        transition: 'color 0.4s',
      }}>
        {score}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SessionScreen({ task, duration, monitorPositions, onEnd }) {
  const totalSeconds = duration * 60
  const { yawLeft: yawLT, yawRight: yawRT, pitchDown: pitchDT } = computeThresholds(monitorPositions)
  const alertDelayMs = monitorPositions.length >= 1 ? 120_000 : 90_000

  const [timeLeft,        setTimeLeft]        = useState(totalSeconds)
  const [showOverlay,     setShowOverlay]     = useState(false)
  const [attentionStatus, setAttentionStatus] = useState('focused')
  const [focusScore,      setFocusScore]      = useState(100)
  const [camHidden,       setCamHidden]       = useState(false)

  const videoRef        = useRef(null)
  const sessionEndedRef = useRef(false)
  const startTimeRef    = useRef(Date.now())

  // ── Detection rolling buffers ────────────────────────────────────────────────
  const blinkTimestampsRef  = useRef([])
  const wasClosedRef        = useRef(false)
  const perclosHistRef      = useRef([])
  const headDownStartRef    = useRef(null)
  const headTurnLeftStartRef  = useRef(null)  // independent timer per direction
  const headTurnRightStartRef = useRef(null)

  // ── Focus score & alert refs ─────────────────────────────────────────────────
  const focusScoreRef       = useRef(100)
  const scoreLowSinceRef    = useRef(null)  // when score first went < 40
  const lastAlertTimeRef    = useRef(0)
  const overlayActiveRef    = useRef(false)
  const attentionStatusRef  = useRef('focused')
  const lastScoreSecRef     = useRef(0)     // last second at which score was displayed

  // ── Session statistics refs ──────────────────────────────────────────────────
  const focusedSecondsRef      = useRef(0)
  const distractionEventsRef   = useRef(0)
  const longestStreakRef        = useRef(0)
  const currentStreakRef        = useRef(0)
  const timelineSnapshotsRef   = useRef([])  // [{second, focused}] every 5 s

  const progress = (totalSeconds - timeLeft) / totalSeconds

  // ── End session ──────────────────────────────────────────────────────────────
  const endSession = useCallback((completed = false) => {
    if (sessionEndedRef.current) return
    sessionEndedRef.current = true
    const actualSeconds = Math.round((Date.now() - startTimeRef.current) / 1000)
    onEnd({
      plannedDuration: duration,
      actualSeconds,
      completed,
      focusLostCount:        distractionEventsRef.current,
      distractionEvents:     distractionEventsRef.current,
      focusedSeconds:        focusedSecondsRef.current,
      longestFocusedStreak:  longestStreakRef.current,
      timeline:              timelineSnapshotsRef.current,
    })
  }, [duration, onEnd])

  // ── Per-frame analysis ───────────────────────────────────────────────────────
  const handleFaceResults = useCallback((results) => {
    if (sessionEndedRef.current) return

    const lmArray  = results.multiFaceLandmarks
    const hasFace  = lmArray?.length > 0
    const now      = Date.now()
    const sessionElapsed = (now - startTimeRef.current) / 1000

    // ── Extract metrics ──────────────────────────────────────────────────────
    let avgEar = 0.30, pitchDeg = 0, yawSigned = 0

    if (hasFace) {
      const f  = analyzeFrame(lmArray[0])
      avgEar    = f.avgEar
      pitchDeg  = f.pitchDeg
      yawSigned = f.yawSigned

      // Blink: rising-edge detection (was closed last frame, now open)
      if (avgEar < EAR_BLINK) {
        wasClosedRef.current = true
      } else if (wasClosedRef.current) {
        wasClosedRef.current = false
        blinkTimestampsRef.current.push(now)
      }

      perclosHistRef.current.push({ t: now, heavy: avgEar < EAR_HEAVY })
    }

    // Purge sliding-window buffers
    const tenAgo   = now - BLINK_WIN_MS
    const sixtyAgo = now - PERCLOS_WIN_MS
    blinkTimestampsRef.current = blinkTimestampsRef.current.filter(t => t > tenAgo)
    perclosHistRef.current     = perclosHistRef.current.filter(f => f.t > sixtyAgo)

    // ── Blink rate ───────────────────────────────────────────────────────────
    const blinkRate    = blinkTimestampsRef.current.length * 6   // /min from 10-s window
    const hasBlinkData = sessionElapsed >= 15

    // ── PERCLOS ──────────────────────────────────────────────────────────────
    const pHist      = perclosHistRef.current
    const perclos    = pHist.length > 0 ? (pHist.filter(f => f.heavy).length / pHist.length) * 100 : 0
    const hasPerclos = sessionElapsed >= 30 && pHist.length >= 15

    // ── Head-down hold (pitch) ────────────────────────────────────────────────
    let headDownSecs = 0
    if (hasFace && pitchDeg >= pitchDT) {
      if (!headDownStartRef.current) headDownStartRef.current = now
      headDownSecs = (now - headDownStartRef.current) / 1000
    } else {
      headDownStartRef.current = null
    }

    // ── Head-turn hold — separate LEFT / RIGHT timers ────────────────────────
    // Each timer only runs while the user is looking past THAT direction's threshold.
    // A monitor position raises the threshold for its direction, so the timer won't
    // start when the user is simply glancing at that monitor.
    let headTurnLeftSecs = 0, headTurnRightSecs = 0

    if (hasFace && yawSigned >= yawLT) {                         // looking LEFT past threshold
      if (!headTurnLeftStartRef.current) headTurnLeftStartRef.current = now
      headTurnLeftSecs = (now - headTurnLeftStartRef.current) / 1000
    } else {
      headTurnLeftStartRef.current = null
    }

    if (hasFace && -yawSigned >= yawRT) {                        // looking RIGHT past threshold
      if (!headTurnRightStartRef.current) headTurnRightStartRef.current = now
      headTurnRightSecs = (now - headTurnRightStartRef.current) / 1000
    } else {
      headTurnRightStartRef.current = null
    }

    // ── Focus score (0–100) ──────────────────────────────────────────────────
    let score = hasFace ? 100 : 0

    if (hasFace) {
      // Blink rate: −20 if outside 8–30 /min
      if (hasBlinkData && blinkRate > 0 && (blinkRate < 8 || blinkRate > 30)) score -= 20

      // PERCLOS: −35 / −15
      if (hasPerclos) {
        if (perclos > 15)     score -= 35
        else if (perclos > 8) score -= 15
      }

      // Pitch down: −30 confirmed (10 s hold), −10 partial
      if (pitchDeg >= pitchDT && headDownSecs >= HEAD_DOWN_HOLD) score -= 30
      else if (pitchDeg >= pitchDT * 0.75)                        score -= 10

      // Yaw LEFT: −30 confirmed (5 s hold), −10 partial
      if (yawSigned >= yawLT && headTurnLeftSecs >= HEAD_TURN_HOLD) score -= 30
      else if (yawSigned >= yawLT * 0.6)                            score -= 10

      // Yaw RIGHT: −30 confirmed (5 s hold), −10 partial
      if (-yawSigned >= yawRT && headTurnRightSecs >= HEAD_TURN_HOLD) score -= 30
      else if (-yawSigned >= yawRT * 0.6)                             score -= 10
    }

    score = Math.max(0, score)
    focusScoreRef.current = score

    // ── Attention status (drives dot colour, checked every frame) ────────────
    const newStatus = score >= 70 ? 'focused' : score >= 40 ? 'distracted' : 'alert'
    if (newStatus !== attentionStatusRef.current) {
      attentionStatusRef.current = newStatus
      setAttentionStatus(newStatus)
    }

    // ── Alert logic ──────────────────────────────────────────────────────────
    if (score < 40) {
      if (!scoreLowSinceRef.current) scoreLowSinceRef.current = now
      const lowFor    = now - scoreLowSinceRef.current
      const cooldownOk = (now - lastAlertTimeRef.current) >= ALERT_COOLDOWN_MS

      if (lowFor >= alertDelayMs && !overlayActiveRef.current && cooldownOk) {
        overlayActiveRef.current = true
        lastAlertTimeRef.current = now
        distractionEventsRef.current += 1
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

  // ── Mediapipe setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!videoRef.current || !window.FaceMesh || !window.Camera) return

    const faceMesh = new window.FaceMesh({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
    })
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })
    faceMesh.onResults(handleFaceResults)

    const camera = new window.Camera(videoRef.current, {
      onFrame: async () => {
        if (videoRef.current && !sessionEndedRef.current) {
          await faceMesh.send({ image: videoRef.current })
        }
      },
      width: 320,
      height: 240,
    })
    camera.start()

    return () => {
      camera.stop()
      faceMesh.close?.()
    }
  }, [handleFaceResults])

  // ── Countdown + per-second stats ─────────────────────────────────────────────
  useEffect(() => {
    const tick = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) { clearInterval(tick); return 0 }
        return prev - 1
      })

      const elapsedSecs = Math.round((Date.now() - startTimeRef.current) / 1000)
      const focused     = focusScoreRef.current >= 40

      // Streak + focused-seconds tracking
      if (focused) {
        focusedSecondsRef.current += 1
        currentStreakRef.current  += 1
        if (currentStreakRef.current > longestStreakRef.current) {
          longestStreakRef.current = currentStreakRef.current
        }
      } else {
        currentStreakRef.current = 0
      }

      // Timeline snapshot every 5 seconds
      if (elapsedSecs > 0 && elapsedSecs % SCORE_UPDATE_SECS === 0) {
        timelineSnapshotsRef.current.push({ second: elapsedSecs, focused })
        setFocusScore(Math.round(focusScoreRef.current))
      }
    }, 1000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    if (timeLeft === 0) endSession(true)
  }, [timeLeft, endSession])

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="session-root">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      <div style={{ position: 'fixed', top: 14, right: 20, zIndex: 15 }}>
        <StatusDot status={attentionStatus} score={focusScore} />
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
          autoPlay
          muted
          playsInline
        />
        <button className="cam-toggle" onClick={() => setCamHidden((h) => !h)}>
          {camHidden ? 'Show camera' : 'Hide'}
        </button>
      </div>

      {showOverlay && (
        <div className="focus-overlay">
          <div className="focus-overlay-inner">
            <p className="focus-overlay-text">Hey — come back.</p>
            <p className="focus-overlay-sub">Your session is still running</p>
          </div>
        </div>
      )}
    </div>
  )
}
