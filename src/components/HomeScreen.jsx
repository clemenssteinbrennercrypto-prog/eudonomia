import { useState, useMemo } from 'react'
import LegalModal from './LegalModal'
import { loadSessions } from '../lib/storage'

function computeStreak() {
  const sessions = loadSessions()
  if (!sessions.length) return 0
  const days = new Set(sessions.map(s => new Date(s.timestamp).toDateString()))
  const today = new Date()
  let streak = 0
  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    if (days.has(d.toDateString())) streak++
    else if (i > 0) break
  }
  return streak
}

// Summarise devices array into a human-readable string
function summariseDevices(devices) {
  if (!devices.length) return null
  const laptops  = devices.filter(d => d.type === 'laptop').length
  const monitors = devices.filter(d => d.type === 'monitor')
  const extra    = monitors.filter(d => d.col !== 0.5 || d.row !== 0.5)
  const main     = monitors.filter(d => d.col === 0.5 && d.row === 0.5)

  const POSITION_NAME = (d) => {
    if (d.col < 0.35) return 'Left'
    if (d.col > 0.65) return 'Right'
    if (d.row < 0.35) return 'Above'
    if (d.row > 0.65) return 'Below'
    return 'Center'
  }

  const parts = []
  if (laptops > 0 && main.length > 0) parts.push('Laptop + monitor')
  else if (laptops > 0) parts.push('Laptop')
  else if (main.length > 0) parts.push('Desktop monitor')

  if (extra.length === 1) {
    parts.push(`1 extra monitor (${POSITION_NAME(extra[0])})`)
  } else if (extra.length === 2) {
    parts.push(`2 extra monitors (${POSITION_NAME(extra[0])}, ${POSITION_NAME(extra[1])})`)
  }

  return parts.join(' · ') || 'Workspace configured'
}

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
  const [legalTab, setLegalTab] = useState(null)
  const [taskFocused, setTaskFocused] = useState(false)
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customVal, setCustomVal] = useState('')
  const isCustomActive = !DURATIONS.includes(duration)
  const streak = useMemo(() => computeStreak(), [])
  const avgFocus = useMemo(() => {
    const sessions = loadSessions()
    const last3 = sessions.slice(0, 3).filter(s => s.actualSeconds > 0 && s.focusedSeconds != null)
    if (last3.length === 0) return null
    const avg = last3.reduce((sum, s) => sum + Math.round((s.focusedSeconds / s.actualSeconds) * 100), 0) / last3.length
    return Math.round(avg)
  }, [])
  const recentTask = useMemo(() => {
    const sessions = loadSessions()
    return sessions[0]?.task || null
  }, [])

  const handleCustomClick = () => {
    setShowCustomInput(true)
  }

  const handlePresetClick = (d) => {
    setDuration(d)
    setShowCustomInput(false)
    setCustomVal('')
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
    <>
    <div className="screen-center">
      <div className="home-content">

        {/* Header row */}
        <div className="home-header" style={{ position: 'relative' }}>
          <div className="home-header-actions" style={{ position: 'absolute', top: 0, right: 0, display: 'flex', gap: 8 }}>
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
          {streak >= 2 && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <span style={{
                background: 'rgba(251,146,60,0.12)', border: '1px solid rgba(251,146,60,0.25)',
                borderRadius: 100, padding: '2px 10px',
                fontSize: 12, fontWeight: 600, color: '#f97316',
                letterSpacing: '0.02em',
              }}>
                🔥 {streak} day streak{avgFocus !== null ? ` · avg ${avgFocus}%` : ''}
              </span>
            </div>
          )}
          <p className="app-tagline">Stay present. Stay focused.</p>
        </div>

        <div className="home-form">

          {/* Device summary bar */}
          {devices.length > 0 ? (
            <div
              onClick={onShowSetup}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px',
                background: '#f9fafb',
                border: '1.5px solid #e5e7eb',
                borderRadius: 12,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#22c55e', fontSize: 10 }}>●</span>
                {summariseDevices(devices)}
              </span>
              <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0, marginLeft: 8 }}>Edit →</span>
            </div>
          ) : (
            <button
              onClick={onShowSetup}
              style={{
                width: '100%', padding: '16px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#fff', border: '1.5px solid #E8E3DA',
                borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
                textAlign: 'left',
              }}
            >
              <div>
                <span style={{ fontSize: 14, color: '#374151', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Set up your workspace for better tracking
                </span>
                <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 400 }}>
                  Tell us where your screens are to improve detection accuracy
                </span>
              </div>
              <span style={{ fontSize: 16, color: '#c4c9d4', marginLeft: 12 }}>→</span>
            </button>
          )}

          {/* Task input */}
          <div className="field">
            <label className="field-label">What are you working on?</label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="text-input"
                value={task}
                onChange={(e) => setTask(e.target.value.slice(0, 80))}
                placeholder="e.g. Writing my thesis introduction"
                autoFocus
                maxLength={80}
                onFocus={() => setTaskFocused(true)}
                onBlur={() => setTaskFocused(false)}
              />
              {(taskFocused || task.length > 60) && (
                <span style={{
                  position: 'absolute', bottom: 6, right: 10,
                  fontSize: 10, color: task.length > 70 ? '#f97316' : '#9ca3af',
                  pointerEvents: 'none', fontVariantNumeric: 'tabular-nums',
                }}>
                  {task.length}/80
                </span>
              )}
            </div>
            {recentTask && recentTask !== task && (
              <button
                onClick={() => setTask(recentTask)}
                style={{
                  marginTop: 6, background: 'none', border: 'none',
                  color: '#6b7280', fontSize: 12, cursor: 'pointer',
                  fontFamily: 'inherit', padding: 0, textAlign: 'left',
                }}
              >
                ↩ {recentTask}
              </button>
            )}
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
                  value={String(customVal)}
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

    {/* Legal footer */}
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      display: 'flex', justifyContent: 'center', gap: 20,
      padding: '12px 24px',
      background: 'linear-gradient(to top, #F5F4F0, transparent)',
    }}>
      <button
        onClick={() => setLegalTab('impressum')}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 11, color: '#9CA3AF', fontFamily: 'inherit',
          letterSpacing: '0.05em', textTransform: 'uppercase',
        }}
      >Impressum</button>
      <button
        onClick={() => setLegalTab('datenschutz')}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 11, color: '#9CA3AF', fontFamily: 'inherit',
          letterSpacing: '0.05em', textTransform: 'uppercase',
        }}
      >Datenschutz</button>
    </div>

    <LegalModal
      open={legalTab !== null}
      onClose={() => setLegalTab(null)}
      initialTab={legalTab ?? 'impressum'}
    />
    </>
  )
}
