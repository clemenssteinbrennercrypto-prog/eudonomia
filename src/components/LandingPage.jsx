import { useState } from 'react'
import LegalModal from './LegalModal'

const FEATURES = [
  {
    num: '01',
    title: 'Set your task',
    body: 'Tell Eudaimonia what you\'re working on and for how long.',
  },
  {
    num: '02',
    title: 'Camera tracks your attention',
    body: 'Blink rate, eye openness, and head position are analyzed locally in real time — nothing leaves your device.',
  },
  {
    num: '03',
    title: 'Get gently called back',
    body: 'If you drift for too long, a calm alert brings you back without breaking your flow.',
  },
]

export default function LandingPage({ onEnter }) {
  const [legalTab, setLegalTab] = useState(null)

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif' }}>

      {/* ── SECTION 1: Hero ──────────────────────────────────────────────── */}
      <section style={{
        minHeight: '100vh',
        background: '#0D0F14',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '80px 24px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Animated gradient overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 50% 60%, #1a2e4a 0%, transparent 70%)',
          animation: 'heroGlow 8s ease-in-out infinite',
          pointerEvents: 'none',
          zIndex: 0,
        }} />
        <div style={{ maxWidth: 600, width: '100%', textAlign: 'center', position: 'relative', zIndex: 1 }}>

          {/* Label pill */}
          <div style={{ marginBottom: 24 }}>
            <span style={{
              display: 'inline-block',
              fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em',
              color: '#94a3b8',
              border: '1px solid #2A2E3A', borderRadius: 100,
              padding: '6px 14px',
            }}>
              Focus tracking — powered by your camera
            </span>
          </div>

          {/* Title */}
          <h1 style={{
            fontSize: 'clamp(36px, 6vw, 64px)',
            fontWeight: 700, letterSpacing: '-0.03em',
            color: '#ffffff', margin: '0 0 20px', lineHeight: 1.1,
          }}>
            Your silent focus guardian
          </h1>

          {/* Subtitle */}
          <p style={{
            fontSize: 17, color: '#94a3b8', lineHeight: 1.7,
            maxWidth: 480, margin: '0 auto 40px',
          }}>
            Eudaimonia watches your attention using your webcam.
            No video recorded. No data sent. Everything stays on your device.
          </p>

          {/* CTA */}
          <button
            onClick={onEnter}
            style={{
              background: '#ffffff', color: '#0D0F14',
              border: 'none', height: 56, padding: '0 36px',
              borderRadius: 14, fontSize: 16, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            Start focusing — it's free
          </button>

          <p style={{ fontSize: 12, color: '#2A2E3A', marginTop: 16 }}>
            Works in your browser · No download · No account
          </p>
        </div>
      </section>

      {/* ── SECTION 2: How it works ──────────────────────────────────────── */}
      <section style={{
        background: '#F5F4F0',
        padding: '96px 24px',
      }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <h2 style={{
            fontSize: 32, fontWeight: 700, letterSpacing: '-0.025em',
            color: '#1A1A1A', textAlign: 'center', marginBottom: 56, margin: '0 0 56px',
          }}>
            How it works
          </h2>

          {FEATURES.map((f) => (
            <div
              key={f.num}
              style={{
                background: '#FFFFFF',
                borderRadius: 16, padding: 28,
                boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
                marginBottom: 16,
                borderLeft: '3px solid #E8E3DA',
                transition: 'border-color 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderLeftColor = '#1a2e4a'}
              onMouseLeave={e => e.currentTarget.style.borderLeftColor = '#E8E3DA'}
            >
              <p style={{
                fontSize: 32, fontWeight: 200, color: '#E8E3DA',
                letterSpacing: '-0.03em', margin: '0 0 8px', lineHeight: 1,
              }}>
                {f.num}
              </p>
              <p style={{ fontSize: 17, fontWeight: 700, color: '#1A1A1A', margin: '0 0 8px', letterSpacing: '-0.015em' }}>
                {f.title}
              </p>
              <p style={{ fontSize: 15, color: '#6B7280', lineHeight: 1.65, margin: 0 }}>
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── SECTION 2.5: Stats ───────────────────────────────────────────── */}
      <section style={{ background: '#FAFAF8', padding: '64px 24px', textAlign: 'center' }}>
        <div style={{
          maxWidth: 720, margin: '0 auto',
          display: 'flex', justifyContent: 'center', gap: 64,
          flexWrap: 'wrap',
        }}>
          {[
            { value: '100%', label: 'Local processing' },
            { value: '0',    label: 'Data sent to servers' },
            { value: 'Free', label: 'No account needed' },
          ].map(({ value, label }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 48, fontWeight: 200, color: '#1a2e4a', lineHeight: 1 }}>{value}</span>
              <span style={{ fontSize: 14, color: '#6B7280', letterSpacing: '0.03em' }}>{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── SECTION 3: Privacy callout ───────────────────────────────────── */}
      <section style={{
        background: '#1a2e4a',
        padding: '64px 24px',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <h2 style={{
            fontSize: 28, fontWeight: 700, color: '#ffffff',
            marginBottom: 16, letterSpacing: '-0.02em',
          }}>
            Built for privacy
          </h2>
          <p style={{
            fontSize: 16, color: 'rgba(255,255,255,0.65)', lineHeight: 1.7,
            maxWidth: 480, margin: '0 auto 32px',
          }}>
            No account. No server. No video storage.
            Your camera feed is processed entirely in your browser
            using MediaPipe — the same technology used by Google Meet.
          </p>
          <button
            onClick={onEnter}
            style={{
              background: '#ffffff', color: '#1a2e4a',
              border: 'none', height: 52, padding: '0 32px',
              borderRadius: 12, fontSize: 15, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            Try it now
          </button>
        </div>
      </section>

      {/* ── SECTION 4: Footer ────────────────────────────────────────────── */}
      <footer style={{ background: '#0D0F14', padding: 24 }}>
        <div style={{
          maxWidth: 640, margin: '0 auto',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#ffffff' }}>
            Eudaimonia
          </span>
          <div style={{ display: 'flex', gap: 16 }}>
            {[
              { id: 'impressum',   label: 'Impressum'   },
              { id: 'datenschutz', label: 'Datenschutz' },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setLegalTab(id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: '#2A2E3A',
                  fontFamily: 'inherit',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </footer>

      <LegalModal
        open={legalTab !== null}
        onClose={() => setLegalTab(null)}
        initialTab={legalTab ?? 'impressum'}
      />
    </div>
  )
}
