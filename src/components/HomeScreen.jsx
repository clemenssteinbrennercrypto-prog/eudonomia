import { useState } from 'react'
import { DEVICE_TYPES, POSITION_LABELS } from './SetupScreen'
import { DEVICE_ICON_MAP } from './DeviceIcons'

const DURATIONS = [15, 30, 60, 90]

export default function HomeScreen({
  task, setTask,
  duration, setDuration,
  goal, setGoal,
  devices,
  onStart,
  onShowHistory,
  onShowSetup,
}) {
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customVal, setCustomVal] = useState('')
  const isCustomActive = !DURATIONS.includes(duration)

  const handleCustomClick = () => {
    setShowCustomInput(true)
  }

  const handleCustomChange = (e) => {
    const val = e.target.value
    setCustomVal(val)
    const n = parseInt(val, 10)
    if (!isNaN(n) && n >= 1 && n <= 180) {
      setDuration(n)
    }
  }

  return (
    <div className="screen-center">
      <div className="home-content">

        {/* Header row */}
        <div className="home-header" style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, right: 0, display: 'flex', gap: 8 }}>
            <button
              onClick={onShowSetup}
              style={{
                background: 'none', border: '1px solid #e5e7eb',
                borderRadius: 100, padding: '6px 14px',
                fontSize: 12, fontWeight: 500, color: '#6b7280',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Setup
            </button>
            <button
              onClick={onShowHistory}
              style={{
                background: 'none', border: '1px solid #e5e7eb',
                borderRadius: 100, padding: '6px 14px',
                fontSize: 12, fontWeight: 500, color: '#6b7280',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              History
            </button>
          </div>
          <h1 className="app-title">Eudaimonia</h1>
          <p className="app-tagline">Stay present. Stay focused.</p>
        </div>

        <div className="home-form">

          {/* Device summary bar */}
          {devices.length > 0 ? (
            <div
              onClick={onShowSetup}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '11px 14px',
                background: '#f9fafb',
                border: '1.5px solid #e5e7eb',
                borderRadius: 12,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1 }}>
                {devices.map((d, i) => {
                  const dt = DEVICE_TYPES.find(t => t.id === d.type)
                  const Icon = DEVICE_ICON_MAP[d.type]
                  return (
                    <span key={i} style={{
                      fontSize: 12, fontWeight: 500, color: '#374151',
                      background: '#fff', border: '1px solid #e5e7eb',
                      borderRadius: 100, padding: '3px 10px',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}>
                      {Icon && <Icon size={18} />}
                      <span style={{ color: '#9ca3af' }}>{POSITION_LABELS[d.position]}</span>
                    </span>
                  )
                })}
              </div>
              <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0 }}>Edit →</span>
            </div>
          ) : (
            <button
              onClick={onShowSetup}
              style={{
                width: '100%', padding: '13px 16px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#f9fafb', border: '1.5px dashed #d1d5db',
                borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <span style={{ fontSize: 14, color: '#9ca3af', fontWeight: 500 }}>
                Configure your workspace setup
              </span>
              <span style={{ fontSize: 13, color: '#c4c9d4' }}>→</span>
            </button>
          )}

          {/* Task input */}
          <div className="field">
            <label className="field-label">What are you working on?</label>
            <input
              type="text"
              className="text-input"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="e.g. Writing my thesis introduction"
              autoFocus
            />
          </div>

          {/* Goal input */}
          <div className="field">
            <label className="field-label">Goal (optional)</label>
            <input
              type="text"
              className="text-input"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Finish intro chapter"
            />
          </div>

          {/* Duration */}
          <div className="field">
            <label className="field-label">Duration</label>
            <div className="duration-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  className={`dur-btn${duration === d ? ' active' : ''}`}
                  onClick={() => { setDuration(d); setShowCustomInput(false); setCustomVal('') }}
                >
                  {d} min
                </button>
              ))}
              <button
                className={`dur-btn${isCustomActive ? ' active' : ''}`}
                onClick={handleCustomClick}
              >
                {isCustomActive ? `${duration} min` : 'Custom'}
              </button>
            </div>
            {showCustomInput && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  min={1} max={180}
                  className="text-input"
                  style={{ width: 120 }}
                  value={customVal}
                  onChange={handleCustomChange}
                  placeholder="1–180 min"
                  autoFocus
                />
                <span style={{ fontSize: 12, color: '#9ca3af' }}>minutes</span>
              </div>
            )}
          </div>

          <button
            className="start-btn"
            onClick={onStart}
            disabled={!task.trim()}
          >
            Start Session
          </button>
        </div>
      </div>
    </div>
  )
}
