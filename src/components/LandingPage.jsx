import { useState } from 'react'
import LegalModal from './LegalModal'

const STEPS = [
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

const font = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif'

export default function LandingPage({ onEnter }) {
  const [legalTab, setLegalTab] = useState(null)

  return (
    <div style={{ fontFamily: font, overflowX: 'hidden' }}>

      <style>{`
        @keyframes heroGlow {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.08); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .hero-cta:hover {
          box-shadow: 0 0 0 1px rgba(255,255,255,0.15), 0 8px 32px rgba(100,149,237,0.35) !important;
          transform: translateY(-1px);
        }
        .hero-cta:active { transform: translateY(0); }
        .step-card:hover {
          border-color: rgba(100,149,237,0.25) !important;
          background: rgba(255,255,255,0.04) !important;
        }
        .faq-card:hover { border-color: rgba(255,255,255,0.1) !important; }
        .pill-btn:hover { color: #ffffff !important; }
      `}</style>

      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <section style={{
        minHeight: '100vh',
        background: '#080A0F',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '80px 24px',
        position: 'relative', overflow: 'hidden',
      }}>

        {/* Layered glow background */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        }}>
          {/* Primary blue glow */}
          <div style={{
            position: 'absolute',
            width: '80vw', height: '80vw',
            maxWidth: 900, maxHeight: 900,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(26,46,74,0.9) 0%, rgba(14,22,44,0.4) 40%, transparent 70%)',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -55%)',
            animation: 'heroGlow 8s ease-in-out infinite',
          }} />
          {/* Secondary accent glow */}
          <div style={{
            position: 'absolute',
            width: '40vw', height: '40vw',
            maxWidth: 500, maxHeight: 500,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(100,149,237,0.08) 0%, transparent 70%)',
            top: '40%', left: '50%',
            transform: 'translate(-50%, -50%)',
          }} />
          {/* Grid pattern */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)
            `,
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse at 50% 50%, black 30%, transparent 80%)',
            WebkitMaskImage: 'radial-gradient(ellipse at 50% 50%, black 30%, transparent 80%)',
          }} />
        </div>

        <div style={{
          maxWidth: 640, width: '100%', textAlign: 'center',
          position: 'relative', zIndex: 1,
          animation: 'fadeUp 0.6s ease',
        }}>

          {/* Label pill */}
          <div style={{ marginBottom: 28 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em',
              color: '#6479a0',
              border: '1px solid rgba(100,121,160,0.25)',
              borderRadius: 100, padding: '6px 16px',
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#6496ed',
                boxShadow: '0 0 6px #6496ed',
                display: 'inline-block',
              }} />
              Focus tracking — powered by your camera
            </span>
          </div>

          {/* Headline */}
          <h1 style={{
            fontSize: 'clamp(42px, 7vw, 76px)',
            fontWeight: 700, letterSpacing: '-0.035em',
            lineHeight: 1.05, margin: '0 0 24px',
            background: 'linear-gradient(180deg, #ffffff 0%, rgba(255,255,255,0.72) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            Your silent<br />focus guardian
          </h1>

          {/* Subtitle */}
          <p style={{
            fontSize: 18, color: 'rgba(255,255,255,0.42)', lineHeight: 1.75,
            maxWidth: 440, margin: '0 auto 44px',
            letterSpacing: '0.01em',
          }}>
            Eudaimonia watches your attention using your webcam.
            No video recorded. No data sent. Everything stays on your device.
          </p>

          {/* CTA */}
          <button
            onClick={onEnter}
            className="hero-cta"
            style={{
              background: 'linear-gradient(135deg, #1a2e4a 0%, #243d61 100%)',
              color: '#ffffff',
              border: '1px solid rgba(100,149,237,0.3)',
              height: 56, padding: '0 40px',
              borderRadius: 14, fontSize: 16, fontWeight: 600,
              cursor: 'pointer', fontFamily: font,
              transition: 'all 0.2s ease',
              boxShadow: '0 0 0 1px rgba(100,149,237,0.1), 0 4px 20px rgba(26,46,74,0.5)',
              letterSpacing: '0.01em',
            }}
          >
            Start focusing — it's free
          </button>

          {/* Trust pills */}
          <div style={{
            display: 'flex', gap: 6, marginTop: 20,
            justifyContent: 'center', flexWrap: 'wrap',
          }}>
            {[
              { icon: '🔒', label: 'Private' },
              { icon: '⚡', label: 'Instant' },
              { icon: '✓', label: 'Free forever' },
            ].map(({ icon, label }) => (
              <span key={label} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 13px', borderRadius: 100,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.07)',
                fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 500,
              }}>
                <span style={{ fontSize: 10 }}>{icon}</span> {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── STATS BAR ─────────────────────────────────────────────────────── */}
      <section style={{
        background: '#0D0F14',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        padding: '44px 24px',
      }}>
        <div style={{
          maxWidth: 720, margin: '0 auto',
          display: 'flex', justifyContent: 'center',
          gap: 0, flexWrap: 'wrap',
        }}>
          {[
            { value: '100%', label: 'Local processing' },
            { value: '0',    label: 'Data sent to servers' },
            { value: 'Free', label: 'No account needed' },
          ].map(({ value, label }, i) => (
            <div key={label} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 6, flex: '1 1 180px',
              padding: '16px 24px',
              borderRight: i < 2 ? '1px solid rgba(255,255,255,0.06)' : 'none',
            }}>
              <span style={{
                fontSize: 42, fontWeight: 200, lineHeight: 1,
                background: 'linear-gradient(135deg, #ffffff 0%, #6496ed 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                {value}
              </span>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.03em' }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────────────────────── */}
      <section style={{ background: '#0A0C12', padding: '100px 24px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>

          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <span style={{
              fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em',
              color: '#4a6080', display: 'block', marginBottom: 14,
            }}>
              How it works
            </span>
            <h2 style={{
              fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 700,
              letterSpacing: '-0.03em', color: '#ffffff', margin: 0,
            }}>
              Three steps to<br />deep focus
            </h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {STEPS.map((s, i) => (
              <div
                key={s.num}
                className="step-card"
                style={{
                  display: 'flex', gap: 28, alignItems: 'flex-start',
                  padding: '28px 32px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: 16,
                  transition: 'all 0.2s ease',
                  cursor: 'default',
                }}
              >
                <span style={{
                  fontSize: 13, fontWeight: 600, color: '#2a3a56',
                  letterSpacing: '0.05em', flexShrink: 0, marginTop: 2,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {s.num}
                </span>
                <div>
                  <p style={{
                    fontSize: 17, fontWeight: 600, color: '#ffffff',
                    margin: '0 0 7px', letterSpacing: '-0.015em',
                  }}>
                    {s.title}
                  </p>
                  <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.38)', lineHeight: 1.7, margin: 0 }}>
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRIVACY CALLOUT ───────────────────────────────────────────────── */}
      <section style={{
        background: 'linear-gradient(135deg, #0f1e35 0%, #1a2e4a 50%, #0f1e35 100%)',
        padding: '88px 24px',
        textAlign: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at 50% 0%, rgba(100,149,237,0.08) 0%, transparent 60%)',
        }} />
        <div style={{ maxWidth: 560, margin: '0 auto', position: 'relative', zIndex: 1 }}>
          <h2 style={{
            fontSize: 'clamp(26px, 4vw, 40px)', fontWeight: 700,
            color: '#ffffff', margin: '0 0 18px', letterSpacing: '-0.025em',
          }}>
            Built for privacy, by design
          </h2>
          <p style={{
            fontSize: 16, color: 'rgba(255,255,255,0.5)', lineHeight: 1.75,
            margin: '0 auto 36px',
          }}>
            No account. No server. No video storage.
            Your camera feed is processed locally on your device
            using MediaPipe.
          </p>
          <button
            onClick={onEnter}
            className="hero-cta"
            style={{
              background: '#ffffff', color: '#1a2e4a',
              border: 'none', height: 52, padding: '0 32px',
              borderRadius: 12, fontSize: 15, fontWeight: 700,
              cursor: 'pointer', fontFamily: font,
              transition: 'all 0.2s ease',
              letterSpacing: '0.01em',
            }}
          >
            Try it now — free
          </button>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <section style={{ background: '#080A0F', padding: '80px 24px' }}>
        <div style={{ maxWidth: 580, margin: '0 auto' }}>
          <h2 style={{
            fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.8)',
            marginBottom: 32, textAlign: 'center', letterSpacing: '-0.02em',
          }}>
            Common questions
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[
              { q: 'Is my camera footage stored?', a: 'Never. Attention processing happens locally on your device using MediaPipe. No frames leave your device.' },
              { q: 'Does it work without a webcam?', a: 'No — the webcam is required for attention tracking. A built-in laptop camera works perfectly.' },
              { q: 'Is it free?', a: 'Yes, completely free. No account, no subscription, no credit card.' },
            ].map(({ q, a }) => (
              <div key={q} className="faq-card" style={{
                padding: '20px 24px',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 12,
                transition: 'border-color 0.2s',
              }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.85)', margin: '0 0 7px' }}>{q}</p>
                <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)', margin: 0, lineHeight: 1.65 }}>{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <footer style={{
        background: '#080A0F',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        padding: '20px 24px',
      }}>
        <div style={{
          maxWidth: 680, margin: '0 auto',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>
            Eudaimonia
          </span>
          <div style={{ display: 'flex', gap: 20 }}>
            {[
              { id: 'impressum',   label: 'Impressum'   },
              { id: 'datenschutz', label: 'Datenschutz' },
            ].map(({ id, label }) => (
              <button
                key={id}
                className="pill-btn"
                onClick={() => setLegalTab(id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, textTransform: 'uppercase',
                  letterSpacing: '0.07em', color: 'rgba(255,255,255,0.25)',
                  fontFamily: font, transition: 'color 0.15s',
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
