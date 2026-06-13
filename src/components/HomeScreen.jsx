import { useState, useMemo, useRef } from 'react'
import LegalModal from './LegalModal'
import { loadSessions } from '../lib/storage'

const QUICK_TAGS = ['Deep work', 'Reading', 'Writing', 'Coding', 'Study', 'Meeting']

const TAG_COLORS = {
  'Deep work': { bg: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.3)', text: '#6366f1' },
  'Reading':   { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', text: '#10b981' },
  'Writing':   { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', text: '#f59e0b' },
  'Coding':    { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)', text: '#3b82f6' },
  'Study':     { bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.3)', text: '#a855f7' },
  'Meeting':   { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.3)',  text: '#ef4444' },
}

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
  tags, setTags,
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
  const sessionCount = useMemo(() => loadSessions().length, [])
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

  const recentGoals = useMemo(() => {
    const sessions = loadSessions()
    const seen = new Set()
    const goals = []
    for (const s of sessions) {
      if (s.goal && s.goal.trim() && !seen.has(s.goal.trim())) {
        seen.add(s.goal.trim())
        goals.push(s.goal.trim())
        if (goals.length >= 5) break
      }
    }
    return goals
  }, [])

  const lastSessionPill = useMemo(() => {
    const sessions = loadSessions()
    if (sessions.length === 0) return null
    const s = sessions[0]
    if (!s || !s.actualSeconds || s.actualSeconds === 0) return null
    const focusPct = s.avgFocusScore != null
      ? s.avgFocusScore
      : s.focusedSeconds != null
        ? Math.round((s.focusedSeconds / s.actualSeconds) * 100)
        : null
    if (focusPct === null) return null
    const minsAgo = Math.round((Date.now() - (s.timestamp || 0)) / 60000)
    let timeStr
    if (minsAgo < 60) timeStr = `${minsAgo}m ago`
    else if (minsAgo < 60 * 24) timeStr = `${Math.round(minsAgo / 60)}h ago`
    else {
      const d = Math.round(minsAgo / 1440)
      timeStr = d === 1 ? 'yesterday' : `${d} days ago`
    }
    return { focusPct, timeStr }
  }, [])

  const durationSuggestion = useMemo(() => {
    const sessions = loadSessions()
    if (sessions.length === 0) return null
    const last = sessions[0]
    if (!last || !last.actualSeconds || last.actualSeconds === 0) return null
    const focusPct = last.focusedSeconds != null
      ? Math.round((last.focusedSeconds / last.actualSeconds) * 100)
      : null
    if (focusPct === null) return null
    const lastDurMin = Math.round(last.actualSeconds / 60)
    if (focusPct > 80) {
      const suggested = Math.min(180, lastDurMin + 15)
      return `Based on your last session, try ${suggested} min`
    } else if (focusPct < 50) {
      const suggested = Math.max(10, Math.min(25, lastDurMin - 10))
      return `Based on your last session, try ${suggested} min`
    }
    return null
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
              History{sessionCount > 0 ? ` (${sessionCount})` : ''}
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
          {lastSessionPill && (
            <div
              onClick={onShowHistory}
              title="View session history"
              style={{ cursor: 'pointer', marginTop: 6 }}
            >
              <span style={{
                background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)',
                borderRadius: 100, padding: '2px 10px',
                fontSize: 11, fontWeight: 500, color: '#64748b',
                letterSpacing: '0.01em',
              }}>
                Last session: {lastSessionPill.focusPct}% focus · {lastSessionPill.timeStr}
              </span>
            </div>
          )}
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
              list="goal-suggestions"
              className="text-input"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Finish intro chapter"
            />
            {recentGoals.length > 0 && (
              <datalist id="goal-suggestions">
                {recentGoals.map(g => <option key={g} value={g} />)}
              </datalist>
            )}
          </div>

          {/* Tag chips */}
          <div className="field">
            <label className="field-label">Tags (optional)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {QUICK_TAGS.map(tag => {
                const active = tags.includes(tag)
                const c = TAG_COLORS[tag] || { bg: '#f3f4f6', border: '#d1d5db', text: '#6b7280' }
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 100,
                      border: `1.5px solid ${active ? c.border : '#e5e7eb'}`,
                      background: active ? c.bg : 'transparent',
                      color: active ? c.text : '#9ca3af',
                      fontSize: 12, fontWeight: active ? 600 : 400,
                      cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
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
            {durationSuggestion && (
              <p style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', margin: '6px 0 0' }}>
                {durationSuggestion}
              </p>
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
