import { useState } from 'react'

const SLIDES = [
  {
    title: 'Your silent focus guardian',
    body: 'Eudaimonia watches your attention using your webcam — no video is recorded or sent anywhere. Everything stays on your device.',
  },
  {
    title: 'Science-backed attention tracking',
    body: 'We track blink rate, eye openness, and head position to calculate a real-time focus score. If you drift for too long, we gently bring you back.',
  },
  {
    title: 'One permission needed',
    body: 'Eudaimonia needs your camera to track attention. Your video is processed locally and never stored.',
  },
  {
    title: 'One more thing',
    body: 'Tell us about your workspace — where are your screens? This helps us calibrate tracking to your setup.',
    cta: 'Set up workspace',
  },
]

export default function Onboarding({ onComplete }) {
  const [slide,   setSlide]   = useState(0)
  const [visible, setVisible] = useState(true) // for fade transition
  const [error,   setError]   = useState(null)
  const [loading, setLoading] = useState(false)

  const isLast = slide === SLIDES.length - 1

  const goNext = () => {
    setVisible(false)
    setTimeout(() => {
      setSlide(s => s + 1)
      setVisible(true)
    }, 200)
  }

  const handleAllow = async () => {
    setError(null)
    setLoading(true)
    try {
      await navigator.mediaDevices.getUserMedia({ video: true })
      localStorage.setItem('eudaimonia_onboarded', 'true')
      goNext()
    } catch {
      setError('Camera access is required. Please allow it in your browser settings.')
    } finally {
      setLoading(false)
    }
  }

  const current = SLIDES[slide]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: '#0D0F14',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
    }}>
      <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 40 }}>

        {/* Logo / wordmark */}
        <div style={{ textAlign: 'center' }}>
          <p style={{
            fontSize: 13, fontWeight: 700, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: '#2A2E3A',
          }}>
            Eudaimonia
          </p>
        </div>

        {/* Slide content */}
        <div style={{
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.2s ease',
          display: 'flex', flexDirection: 'column', gap: 20,
          minHeight: 140,
        }}>
          <h1 style={{
            fontSize: 32, fontWeight: 700,
            letterSpacing: '-0.026em',
            color: '#FFFFFF',
            lineHeight: 1.15,
            margin: 0,
          }}>
            {current.title}
          </h1>
          <p style={{
            fontSize: 16, color: '#94a3b8',
            lineHeight: 1.65, margin: 0,
            fontWeight: 400,
          }}>
            {current.body}
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div style={{
            background: '#1F0A0A',
            border: '1px solid #7f1d1d',
            borderRadius: 12,
            padding: '12px 16px',
            fontSize: 13, color: '#fca5a5',
            lineHeight: 1.5,
          }}>
            {error}
          </div>
        )}

        {/* CTA button */}
        <button
          onClick={isLast ? onComplete : (slide === 2 ? handleAllow : goNext)}
          disabled={loading}
          style={{
            width: '100%', height: 52,
            fontSize: 15, fontWeight: 700,
            background: loading ? '#1a2e4a80' : '#1a2e4a',
            color: '#FFFFFF',
            border: 'none', borderRadius: 14,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            letterSpacing: '0.01em',
            transition: 'opacity 0.15s, background 0.15s',
          }}
        >
          {loading ? 'Requesting access…' : current.cta ? current.cta : (slide === 2 ? 'Allow camera & start' : 'Next →')}
        </button>

        {/* Dot indicator */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
          {SLIDES.map((_, i) => (
            <div key={i} style={{
              width: i === slide ? 20 : 6,
              height: 6,
              borderRadius: 3,
              background: i === slide ? '#FFFFFF' : '#2A2E3A',
              transition: 'width 0.25s ease, background 0.25s ease',
            }} />
          ))}
        </div>

      </div>
    </div>
  )
}
