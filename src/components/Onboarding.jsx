import { useEffect, useRef, useState } from 'react'

// ── Premium onboarding ────────────────────────────────────────────────────────
// The whole point of these first 30 seconds: don't *tell* people the webcam
// reads their focus — *show* them. The flow ends on a live "awakening" moment
// where their own face appears inside a ring that scans + locks on. That single
// moment is the product's promise made real.

const font = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", system-ui, sans-serif'

const SLIDES = [
  {
    kicker: 'Eudaimonia',
    title: 'Meet your\nfocus guardian',
    body: 'It watches your attention through your webcam and pulls you back the moment you drift — quietly, on your side.',
    cta: 'Show me',
  },
  {
    kicker: 'How it works',
    title: 'It reads the\nsignals of focus',
    body: 'Blink rate, eye openness, head position — turned into a live focus score. No video is recorded. No data leaves your device. Ever.',
    cta: 'Continue',
  },
  {
    kicker: 'One permission',
    title: 'Let it see\nyour focus',
    body: 'Eudaimonia needs your camera to sense attention. Everything is processed locally, in real time, and instantly discarded.',
    cta: 'Enable camera',
  },
]

// The recurring brand motif — a focus ring. Rendered at different intensities.
function RingMark({ size = 88, active = false }) {
  const r = size / 2 - 6
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="url(#ringGrad)" strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (active ? 0.12 : 0.55)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.22,1,0.36,1)' }}
      />
      <circle cx={size / 2} cy={6} r={3.5} fill="#6496ed"
        style={{ transformOrigin: `${size / 2}px ${size / 2}px`, animation: 'ringSpin 3.6s linear infinite' }} />
      <defs>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6496ed" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0)        // 0..2 slides, 3 = awakening
  const [visible, setVisible] = useState(true)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [awakenPhase, setAwakenPhase] = useState('scanning') // scanning → locked
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  const isAwakening = step === 3

  // Attach / detach the live webcam during the awakening moment.
  useEffect(() => {
    if (!isAwakening || !streamRef.current) return
    const v = videoRef.current
    if (v) {
      v.srcObject = streamRef.current
      v.play().catch(() => {})
    }
    // Cinematic beat: scan for a moment, then "lock on", then hand off.
    const lock = setTimeout(() => setAwakenPhase('locked'), 2600)
    const done = setTimeout(() => finish(), 4600)
    return () => { clearTimeout(lock); clearTimeout(done) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAwakening])

  // Always release the camera when leaving onboarding.
  useEffect(() => () => stopStream(), [])

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  function finish() {
    stopStream()
    onComplete()
  }

  const transitionTo = (next) => {
    setVisible(false)
    setTimeout(() => { setStep(next); setVisible(true) }, 220)
  }

  const handleEnableCamera = async () => {
    setError(null)
    setLoading(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      localStorage.setItem('eudaimonia_onboarded', 'true')
      setLoading(false)
      setAwakenPhase('scanning')
      transitionTo(3) // → the awakening
    } catch {
      setLoading(false)
      setError('Camera access is needed to sense your focus. Allow it for Eudaimonia in System Settings, then try again.')
    }
  }

  const slide = SLIDES[step] || SLIDES[0]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300, overflow: 'hidden',
      background: '#080A0F', fontFamily: font,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px',
    }}>
      <style>{`
        @keyframes ringSpin { to { transform: rotate(360deg); } }
        @keyframes ambientPulse { 0%,100% { opacity: .5; transform: translate(-50%,-50%) scale(1); } 50% { opacity: .85; transform: translate(-50%,-50%) scale(1.12); } }
        @keyframes riseIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scanSweep { 0% { transform: translateY(-100%); } 100% { transform: translateY(100%); } }
        @keyframes lockPop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes softPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.0); } 50% { box-shadow: 0 0 0 6px rgba(34,197,94,0.10); } }
        .ob-cta:hover { transform: translateY(-1px); box-shadow: 0 10px 30px rgba(122,152,255,0.55); }
        .ob-cta:active { transform: translateY(0); }
      `}</style>

      {/* Ambient glow */}
      <div style={{
        position: 'absolute', top: '46%', left: '50%',
        width: 620, height: 620, borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(circle, rgba(122,152,255,0.85) 0%, rgba(14,22,44,0.35) 40%, transparent 70%)',
        animation: 'ambientPulse 7s ease-in-out infinite',
      }} />

      {!isAwakening ? (
        // ── Slides ────────────────────────────────────────────────────────────
        <div style={{ position: 'relative', width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34 }}>
          <div style={{ opacity: visible ? 1 : 0, transition: 'opacity .22s ease' }}>
            <RingMark size={92} active={step >= 1} />
          </div>

          <div key={step} style={{
            textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16, minHeight: 168,
            opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(10px)',
            transition: 'opacity .22s ease, transform .22s ease',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#5a6b8c' }}>
              {slide.kicker}
            </span>
            <h1 style={{ fontSize: 'clamp(30px,7vw,40px)', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)', lineHeight: 1.08, margin: 0, whiteSpace: 'pre-line' }}>
              {slide.title}
            </h1>
            <p style={{ fontSize: 16, color: '#93a1bd', lineHeight: 1.65, margin: '2px auto 0', maxWidth: 380, fontWeight: 400 }}>
              {slide.body}
            </p>
          </div>

          {error && (
            <div style={{ background: 'rgba(127,29,29,0.25)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 12, padding: '11px 15px', fontSize: 13, color: '#fca5a5', lineHeight: 1.5, textAlign: 'center', maxWidth: 400 }}>
              {error}
            </div>
          )}

          <button
            className="ob-cta"
            onClick={() => step === 2 ? handleEnableCamera() : transitionTo(step + 1)}
            disabled={loading}
            style={{
              width: '100%', maxWidth: 340, height: 54, fontSize: 15.5, fontWeight: 700,
              background: 'linear-gradient(135deg,var(--ultra) 0%,#243d61 100%)', color: 'var(--text)',
              border: '1px solid rgba(100,149,237,0.3)', borderRadius: 15,
              cursor: loading ? 'default' : 'pointer', fontFamily: font, letterSpacing: '0.01em',
              boxShadow: '0 6px 24px rgba(122,152,255,0.45)', transition: 'all .18s ease',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Requesting camera…' : slide.cta}
          </button>

          <div style={{ display: 'flex', gap: 7 }}>
            {SLIDES.map((_, i) => (
              <div key={i} style={{ width: i === step ? 22 : 6, height: 6, borderRadius: 3, background: i === step ? 'var(--ultra-bright)' : 'rgba(255,255,255,0.14)', transition: 'width .3s ease, background .3s ease' }} />
            ))}
          </div>
        </div>
      ) : (
        // ── The awakening: live "it sees you" moment ──────────────────────────
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30, animation: 'riseIn .5s ease' }}>
          <div style={{
            position: 'relative', width: 260, height: 260, borderRadius: '50%',
            animation: awakenPhase === 'locked' ? 'softPulse 2s ease-in-out infinite' : 'none',
          }}>
            {/* Live webcam, circular, mirrored */}
            <div style={{ position: 'absolute', inset: 14, borderRadius: '50%', overflow: 'hidden', background: '#0D0F14' }}>
              <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', filter: awakenPhase === 'locked' ? 'saturate(1.05)' : 'grayscale(0.5) brightness(0.85)', transition: 'filter .8s ease' }} />
              {/* scan sweep while calibrating */}
              {awakenPhase === 'scanning' && (
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: 0, right: 0, height: '40%', background: 'linear-gradient(180deg, transparent, rgba(100,149,237,0.28), transparent)', animation: 'scanSweep 1.6s ease-in-out infinite' }} />
                </div>
              )}
            </div>

            {/* Ring around the face */}
            <svg width={260} height={260} viewBox="0 0 260 260" style={{ position: 'absolute', inset: 0 }}>
              <circle cx="130" cy="130" r="122" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" />
              <circle
                cx="130" cy="130" r="122" fill="none"
                stroke={awakenPhase === 'locked' ? 'var(--good)' : 'var(--ultra-bright)'} strokeWidth="3.5" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 122}
                strokeDashoffset={(2 * Math.PI * 122) * (awakenPhase === 'locked' ? 0 : 0.35)}
                transform="rotate(-90 130 130)"
                style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(0.22,1,0.36,1), stroke .6s ease', filter: awakenPhase === 'locked' ? 'drop-shadow(0 0 12px rgba(34,197,94,0.5))' : 'drop-shadow(0 0 10px rgba(100,149,237,0.4))' }}
              />
            </svg>

            {/* Lock checkmark */}
            {awakenPhase === 'locked' && (
              <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', width: 40, height: 40, borderRadius: '50%', background: 'var(--good)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'lockPop .5s cubic-bezier(0.22,1,0.36,1)', boxShadow: '0 6px 20px rgba(34,197,94,0.5)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
            )}
          </div>

          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 60 }}>
            <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', margin: 0, transition: 'all .4s ease' }}>
              {awakenPhase === 'locked' ? "You're locked in." : 'Calibrating to you…'}
            </h2>
            <p style={{ fontSize: 14.5, color: '#93a1bd', margin: 0, lineHeight: 1.5 }}>
              {awakenPhase === 'locked' ? 'Eudaimonia can see your focus now.' : 'Learning what your attention looks like.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
