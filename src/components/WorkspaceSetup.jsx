import { useState } from 'react'
import StandardSetup from './SetupScreen'
import AdvancedSetup from './IsometricWorkspace'

const navy = '#1a2e4a'

export default function WorkspaceSetup({ devices, setDevices, onContinue }) {
  // Detect mode from stored devices: advanced devices have col/row numbers
  const [mode, setMode] = useState(() => {
    if (!devices.length) return 'standard'
    return typeof devices[0].col === 'number' ? 'advanced' : 'standard'
  })

  const handleModeSwitch = (newMode) => {
    // Clear devices when switching mode (formats are incompatible)
    if (newMode !== mode && devices.length > 0) {
      if (!window.confirm('Switching modes will clear your current setup. Continue?')) return
      setDevices([])
    }
    setMode(newMode)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#FAFAF8' }}>

      {/* Mode toggle bar */}
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        padding: '14px 24px',
        background: '#fff',
        borderBottom: '1px solid #E8E4DC',
        gap: 8,
      }}>
        <div style={{
          display: 'flex',
          background: '#f1f5f9',
          borderRadius: 12,
          padding: 4,
          gap: 4,
        }}>
          <ModeTab
            id="standard"
            active={mode === 'standard'}
            label="Standard"
            desc="Simple grid · works for any setup"
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="1" y="1" width="7" height="7" rx="2" fill={mode==='standard' ? '#fff' : '#94a3b8'}/>
                <rect x="10" y="1" width="7" height="7" rx="2" fill={mode==='standard' ? '#fff' : '#94a3b8'}/>
                <rect x="1" y="10" width="7" height="7" rx="2" fill={mode==='standard' ? '#fff' : '#94a3b8'}/>
                <rect x="10" y="10" width="7" height="7" rx="2" fill={mode==='standard' ? '#fff' : '#94a3b8'}/>
              </svg>
            }
            onClick={() => handleModeSwitch('standard')}
          />
          <ModeTab
            id="advanced"
            active={mode === 'advanced'}
            label="Advanced"
            desc="3D desk · drag & resize"
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 2 L16 6 L9 10 L2 6 Z" fill={mode==='advanced' ? '#fff' : '#94a3b8'} opacity={0.9}/>
                <path d="M2 6 L2 12 L9 16 L9 10 Z" fill={mode==='advanced' ? '#fff' : '#94a3b8'} opacity={0.6}/>
                <path d="M16 6 L16 12 L9 16 L9 10 Z" fill={mode==='advanced' ? '#fff' : '#94a3b8'} opacity={0.75}/>
              </svg>
            }
            onClick={() => handleModeSwitch('advanced')}
          />
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1 }}>
        {mode === 'standard' ? (
          <StandardSetup
            devices={devices}
            setDevices={setDevices}
            onContinue={onContinue}
          />
        ) : (
          <AdvancedSetup
            devices={devices}
            setDevices={setDevices}
            onContinue={onContinue}
          />
        )}
      </div>
    </div>
  )
}

function ModeTab({ id, active, label, desc, icon, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 18px',
        background: active ? navy : 'transparent',
        border: 'none',
        borderRadius: 9,
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.18s',
      }}
    >
      {icon}
      <div style={{ textAlign: 'left' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: active ? '#fff' : '#64748b', letterSpacing: '0.01em' }}>
          {label}
        </div>
        <div style={{ fontSize: 10, color: active ? 'rgba(255,255,255,0.6)' : '#94a3b8', marginTop: 1 }}>
          {desc}
        </div>
      </div>
    </button>
  )
}
