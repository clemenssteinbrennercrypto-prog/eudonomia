import { useState } from 'react'
import IsometricWorkspace from './IsometricWorkspace'

// ── Step-by-step workspace wizard ─────────────────────────────────────────────
// Outputs devices in the same {type, col, row} format as before
// so SessionScreen.jsx detection thresholds are unaffected.

const navy = '#1a2e4a'

// Position → col/row coords
const POSITION_COORDS = {
  left:  { col: 0.2, row: 0.5 },
  right: { col: 0.8, row: 0.5 },
  above: { col: 0.5, row: 0.2 },
  below: { col: 0.5, row: 0.8 },
}

function buildDevices(mainScreen, extraCount, extraPositions) {
  const devices = []

  // Main screen (centered)
  if (mainScreen === 'laptop' || mainScreen === 'both') {
    devices.push({ id: 'main_laptop', type: 'laptop', col: 0.5, row: 0.5 })
  }
  if (mainScreen === 'monitor' || mainScreen === 'both') {
    devices.push({ id: 'main_monitor', type: 'monitor', col: 0.5, row: 0.5 })
  }

  // Extra monitors
  for (let i = 0; i < extraCount; i++) {
    const pos = extraPositions[i] || 'right'
    const coords = POSITION_COORDS[pos]
    devices.push({ id: `extra_${i}`, type: 'monitor', ...coords })
  }

  return devices
}

// ── Pill option button ────────────────────────────────────────────────────────
function PillOption({ label, selected, onClick, sub }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', height: sub ? 60 : 52,
        display: 'flex', flexDirection: 'column',
        alignItems: 'flex-start', justifyContent: 'center',
        padding: '0 22px',
        background: selected ? navy : '#fff',
        color: selected ? '#fff' : '#1A1A1A',
        border: `1.5px solid ${selected ? navy : '#E8E3DA'}`,
        borderRadius: 100,
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 15,
        fontWeight: selected ? 600 : 500,
        transition: 'all 0.15s ease',
        textAlign: 'left',
      }}
    >
      <span>{label}</span>
      {sub && (
        <span style={{
          fontSize: 11, fontWeight: 400,
          color: selected ? 'rgba(255,255,255,0.65)' : '#9ca3af',
          marginTop: 1,
        }}>
          {sub}
        </span>
      )}
    </button>
  )
}

// ── Position picker for a single extra screen ────────────────────────────────
function PositionPicker({ label, value, onChange }) {
  const opts = [
    { id: 'left',  label: '← Left'  },
    { id: 'right', label: 'Right →' },
    { id: 'above', label: '↑ Above' },
    { id: 'below', label: '↓ Below' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{
        fontSize: 13, fontWeight: 600, color: '#6b7280',
        margin: 0, letterSpacing: '0.01em',
      }}>
        {label}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {opts.map(o => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            style={{
              height: 44,
              background: value === o.id ? navy : '#fff',
              color: value === o.id ? '#fff' : '#374151',
              border: `1.5px solid ${value === o.id ? navy : '#E8E3DA'}`,
              borderRadius: 100,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: value === o.id ? 600 : 500,
              transition: 'all 0.15s',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Root export: wizard or advanced ──────────────────────────────────────────
export default function WorkspaceSetup({ devices, setDevices, onContinue }) {
  const [mode, setMode] = useState(() => localStorage.getItem('eudaimonia_setup_mode') || 'wizard')

  const switchMode = (m) => {
    localStorage.setItem('eudaimonia_setup_mode', m)
    setMode(m)
  }

  if (mode === 'advanced') {
    return (
      <div style={{ position: 'relative' }}>
        <IsometricWorkspace
          devices={devices}
          setDevices={setDevices}
          onContinue={onContinue}
        />
        <button
          onClick={() => switchMode('wizard')}
          style={{
            position: 'fixed', top: 22, left: 24, zIndex: 999,
            background: 'rgba(255,255,255,0.9)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #E8E3DA',
            borderRadius: 100, padding: '6px 16px',
            fontSize: 12, fontWeight: 500, color: '#6B7280',
            cursor: 'pointer',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
            transition: 'color 0.15s',
          }}
        >
          ← Simple mode
        </button>
      </div>
    )
  }

  return <Wizard devices={devices} setDevices={setDevices} onContinue={onContinue} onAdvanced={() => switchMode('advanced')} />
}

// ── Wizard ────────────────────────────────────────────────────────────────────
function Wizard({ devices, setDevices, onContinue, onAdvanced }) {
  // Derive initial state from existing devices if any
  const [step, setStep] = useState(1)
  const [mainScreen,      setMainScreen]      = useState(null)   // 'laptop' | 'monitor' | 'both'
  const [extraCount,      setExtraCount]      = useState(null)   // 0 | 1 | 2
  const [extraPositions,  setExtraPositions]  = useState(['right', 'right'])

  // Compute total steps based on answers
  const totalSteps = mainScreen === 'both'
    ? 1                            // both → no need to ask about extras
    : extraCount > 0 ? 3 : 2      // if extras → show position step

  const handleNext = () => {
    if (step === 1) {
      if (mainScreen === 'both') {
        // Done — no extras possible
        finish(0, [])
        return
      }
      setStep(2)
    } else if (step === 2) {
      if (extraCount === 0) {
        finish(0, [])
      } else {
        setStep(3)
      }
    } else if (step === 3) {
      finish(extraCount, extraPositions)
    }
  }

  const finish = (count, positions) => {
    const devs = buildDevices(mainScreen, count, positions)
    setDevices(devs)
    onContinue()
  }

  const handleBack = () => {
    if (step === 1) {
      onContinue() // cancel — go back to home without changes
    } else {
      setStep(s => s - 1)
    }
  }

  const canAdvance = () => {
    if (step === 1) return mainScreen !== null
    if (step === 2) return extraCount !== null
    if (step === 3) return extraPositions.slice(0, extraCount).every(p => p !== null)
    return false
  }

  const setExtraPosition = (idx, pos) => {
    setExtraPositions(prev => {
      const next = [...prev]
      next[idx] = pos
      return next
    })
  }

  const stepLabel = mainScreen === 'both'
    ? 'Step 1 of 1'
    : `Step ${step} of ${extraCount === null ? '?' : totalSteps}`

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F5F4F0',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '40px 24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
    }}>

      {/* Back + Advanced row */}
      <div style={{
        width: '100%', maxWidth: 460, marginBottom: 14,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <button
          onClick={handleBack}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, color: '#9CA3AF', fontFamily: 'inherit',
            padding: 0,
          }}
        >
          ← Back
        </button>
        <button
          onClick={onAdvanced}
          style={{
            background: 'none',
            border: '1px solid #E8E3DA',
            borderRadius: 100, padding: '5px 14px',
            fontSize: 12, fontWeight: 500,
            color: '#6B7280', cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Advanced mode →
        </button>
      </div>

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 460,
        background: '#fff',
        borderRadius: 20,
        padding: '40px 36px',
        boxShadow: '0 2px 24px rgba(0,0,0,0.07)',
        display: 'flex', flexDirection: 'column', gap: 28,
      }}>

        {/* Step indicator */}
        <p style={{
          fontSize: 11, fontWeight: 700,
          color: '#9CA3AF', letterSpacing: '0.09em',
          textTransform: 'uppercase', margin: 0,
        }}>
          {stepLabel}
        </p>

        {/* Step content */}
        {step === 1 && (
          <StepOne
            mainScreen={mainScreen}
            setMainScreen={setMainScreen}
          />
        )}
        {step === 2 && (
          <StepTwo
            extraCount={extraCount}
            setExtraCount={setExtraCount}
          />
        )}
        {step === 3 && (
          <StepThree
            extraCount={extraCount}
            extraPositions={extraPositions}
            setExtraPosition={setExtraPosition}
          />
        )}

        {/* CTA */}
        <button
          onClick={handleNext}
          disabled={!canAdvance()}
          style={{
            width: '100%', height: 56,
            fontSize: 16, fontWeight: 700,
            background: canAdvance() ? navy : '#e2e8f0',
            color: canAdvance() ? '#fff' : '#9ca3af',
            border: 'none', borderRadius: 14,
            cursor: canAdvance() ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            letterSpacing: '0.01em',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {step === 1 && mainScreen === 'both' ? 'Done' :
           step === 2 && extraCount === 0 ? 'Done' :
           step === 3 ? 'Done' : 'Next →'}
        </button>

      </div>
    </div>
  )
}

// ── Step components ───────────────────────────────────────────────────────────

function StepOne({ mainScreen, setMainScreen }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: '#0f172a', margin: '0 0 8px' }}>
          What's your main screen?
        </h2>
        <p style={{ fontSize: 14, color: '#9ca3af', margin: 0 }}>
          The screen directly in front of you
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <PillOption
          label="Laptop screen"
          selected={mainScreen === 'laptop'}
          onClick={() => setMainScreen('laptop')}
        />
        <PillOption
          label="Desktop monitor"
          selected={mainScreen === 'monitor'}
          onClick={() => setMainScreen('monitor')}
        />
        <PillOption
          label="Both — laptop + monitor"
          sub="e.g. laptop open next to an external monitor"
          selected={mainScreen === 'both'}
          onClick={() => setMainScreen('both')}
        />
      </div>
    </div>
  )
}

function StepTwo({ extraCount, setExtraCount }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: '#0f172a', margin: '0 0 8px' }}>
          Any extra screens?
        </h2>
        <p style={{ fontSize: 14, color: '#9ca3af', margin: 0 }}>
          Additional monitors besides your main one
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <PillOption
          label="No, just the one"
          selected={extraCount === 0}
          onClick={() => setExtraCount(0)}
        />
        <PillOption
          label="Yes, one more monitor"
          selected={extraCount === 1}
          onClick={() => setExtraCount(1)}
        />
        <PillOption
          label="Yes, two more monitors"
          selected={extraCount === 2}
          onClick={() => setExtraCount(2)}
        />
      </div>
    </div>
  )
}

function StepThree({ extraCount, extraPositions, setExtraPosition }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: '#0f172a', margin: '0 0 8px' }}>
          Where are they?
        </h2>
        <p style={{ fontSize: 14, color: '#9ca3af', margin: 0 }}>
          Position relative to where you're sitting
        </p>
      </div>
      {Array.from({ length: extraCount }).map((_, i) => (
        <PositionPicker
          key={i}
          label={extraCount > 1 ? `Monitor ${i + 1}` : 'Extra monitor'}
          value={extraPositions[i]}
          onChange={pos => setExtraPosition(i, pos)}
        />
      ))}
    </div>
  )
}
