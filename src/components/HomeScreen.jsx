import { useState, useMemo } from 'react'
import LegalModal from './LegalModal'
import { loadOutputFolder, pickOutputFolder, saveOutputFolder, loadFocusAppsConfig, loadSessions } from '../lib/storage'

const QUICK_TAGS = ['Deep work', 'Reading', 'Writing', 'Coding', 'Study', 'Meeting']

const TAG_COLORS = {
  'Deep work': { bg: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.3)', text: '#A5B4FC' },
  'Reading':   { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', text: '#5EEAD4' },
  'Writing':   { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', text: '#FCD34D' },
  'Coding':    { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)', text: '#93C5FD' },
  'Study':     { bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.3)', text: '#D8B4FE' },
  'Meeting':   { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.3)',  text: '#FCA5A5' },
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

function hasMeasuredFocus(session) {
  if (!session || session.scoreMeasured === false) return false
  if (session.trackingFaulted && session.avgFocusScore == null && session.finalScore == null) return false
  return session.actualSeconds > 0 && session.focusedSeconds != null
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
const ENERGY_LEVELS = [
  { value: 'fresh', label: 'Fresh', hint: 'Full standard' },
  { value: 'medium', label: 'Medium', hint: 'Normal read' },
  { value: 'tired', label: 'Tired', hint: 'Gentler bar' },
]

export default function HomeScreen({
  task, setTask,
  duration, setDuration,
  goal, setGoal,
  intendedOutput, setIntendedOutput,
  successCriteria, setSuccessCriteria,
  energyLevel, setEnergyLevel,
  tags, setTags,
  devices,
  focusModeEnabled,
  setFocusModeEnabled,
  onStart,
  onShowHistory,
  onShowSetup,
  onShowFocusApps,
}) {
  const [legalTab, setLegalTab] = useState(null)
  const [outputFolder, setOutputFolder] = useState(loadOutputFolder)
  const canPickFolder = Boolean(window.__TAURI__?.core?.invoke)
  const [taskFocused, setTaskFocused] = useState(false)
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customVal, setCustomVal] = useState('')
  const isCustomActive = !DURATIONS.includes(duration)
  const streak = useMemo(() => computeStreak(), [])
  const sessionCount = useMemo(() => loadSessions().length, [])
  const focusAppsConfig = useMemo(() => loadFocusAppsConfig(), [])
  const avgFocus = useMemo(() => {
    const sessions = loadSessions()
    const last3 = sessions.slice(0, 3).filter(hasMeasuredFocus)
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
    if (!hasMeasuredFocus(s)) return null
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
    if (!hasMeasuredFocus(last)) return null
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
        <div className="home-header">
          <h1 className="app-title">Eudaimonia</h1>
          <div className="home-header-actions">
            <button className="home-header-action" onClick={onShowSetup}>
              Setup
            </button>
            <button className="home-header-action" onClick={onShowHistory}>
              History{sessionCount > 0 ? ` (${sessionCount})` : ''}
            </button>
          </div>
          {streak >= 2 && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <span style={{
                background: 'rgba(251,146,60,0.12)', border: '1px solid rgba(251,146,60,0.25)',
                borderRadius: 100, padding: '2px 10px',
                fontSize: 12, fontWeight: 600, color: 'var(--warn)',
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
                fontSize: 11, fontWeight: 500, color: 'var(--text-muted)',
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
                padding: '11px 14px',
                background: 'transparent',
                border: '1px solid var(--line)',
                borderRadius: 12,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--good)', fontSize: 10 }}>●</span>
                {summariseDevices(devices)}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8 }}>Edit →</span>
            </div>
          ) : (
            <button
              onClick={onShowSetup}
              style={{
                width: '100%', padding: '16px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'transparent', border: '1px solid var(--line)',
                borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
                textAlign: 'left',
              }}
            >
              <div>
                <span style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Set up your workspace for better tracking
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
                  Tell us where your screens are to improve detection accuracy
                </span>
              </div>
              <span style={{ fontSize: 16, color: 'var(--text-muted)', marginLeft: 12 }}>→</span>
            </button>
          )}

          <button
            type="button"
            onClick={onShowFocusApps}
            style={{
              width: '100%',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'transparent',
              border: '1px solid var(--line)',
              borderRadius: 14,
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              Focus Apps
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8 }}>
              {focusAppsConfig.focusApps.length} focus apps · {focusAppsConfig.distractionApps.length} blocked
            </span>
          </button>

          {/* Output evidence: which folder this session's work lives in. The
              companion compares it before and after to answer "did anything
              actually get made", reading metadata only. Native app only —
              a browser has no folder picker. */}
          {canPickFolder && (
            <button
              type="button"
              onClick={async () => {
                const picked = await pickOutputFolder()
                if (picked) setOutputFolder(saveOutputFolder(picked))
              }}
              style={{
                width: '100%',
                padding: '11px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                background: 'transparent',
                border: '1px solid var(--line)',
                borderRadius: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                Work folder
              </span>
              <span style={{
                fontSize: 12, color: outputFolder ? 'var(--text-secondary)' : 'var(--text-muted)',
                flexShrink: 1, minWidth: 0, marginLeft: 8,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                direction: 'rtl',
              }}>
                {outputFolder || 'Optional — measures what got made'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setFocusModeEnabled(prev => !prev)}
            aria-pressed={focusModeEnabled}
            style={{
              width: '100%',
              padding: '11px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              background: 'transparent',
              border: '1px solid var(--line)',
              borderRadius: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              Focus mode: {focusModeEnabled ? 'ON' : 'OFF'}
            </span>
            <span style={{
              width: 42,
              height: 24,
              borderRadius: 100,
              background: focusModeEnabled ? 'rgba(47,227,168,0.55)' : 'var(--line-strong)',
              padding: 3,
              display: 'inline-flex',
              justifyContent: focusModeEnabled ? 'flex-end' : 'flex-start',
              transition: 'background 0.15s ease',
              flexShrink: 0,
            }}>
              <span style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: 'var(--surface)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
              }} />
            </span>
          </button>

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
                  color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
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

          <div className="field">
            <label className="field-label">Concrete output</label>
            <input
              type="text"
              className="text-input"
              value={intendedOutput}
              onChange={(e) => setIntendedOutput(e.target.value.slice(0, 120))}
              placeholder="What should exist at the end?"
              maxLength={120}
            />
          </div>

          <div className="field">
            <label className="field-label">Success looks like (optional)</label>
            <input
              type="text"
              className="text-input"
              value={successCriteria}
              onChange={(e) => setSuccessCriteria(e.target.value.slice(0, 120))}
              placeholder="e.g. Draft sent, PR reviewed, 10 pages read"
              maxLength={120}
            />
          </div>

          <div className="field">
            <label className="field-label">Energy</label>
            <div className="energy-grid">
              {ENERGY_LEVELS.map(({ value, label, hint }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setEnergyLevel(value)}
                  aria-pressed={energyLevel === value}
                  className={`energy-btn${energyLevel === value ? ' active' : ''}`}
                >
                  <span>{label}</span>
                  <small>{hint}</small>
                </button>
              ))}
            </div>
          </div>

          {/* Tag chips */}
          <div className="field">
            <label className="field-label">Tags (optional)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {QUICK_TAGS.map(tag => {
                const active = tags.includes(tag)
                const c = TAG_COLORS[tag] || { bg: 'rgba(122,152,255,0.08)', border: 'var(--line)', text: 'var(--text-secondary)' }
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 100,
                      border: `1px solid ${active ? c.border : 'var(--line)'}`,
                      background: active ? c.bg : 'transparent',
                      color: active ? c.text : 'var(--text-muted)',
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
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>minutes</span>
              </div>
            )}
            {durationSuggestion && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', margin: '6px 0 0' }}>
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
    {/* Sits at the end of the page rather than floating over it — a fixed bar
        was covering the duration row on shorter screens. */}
    <div style={{
      display: 'flex', justifyContent: 'center', gap: 20,
      padding: '4px 24px 28px',
    }}>
      <button
        onClick={() => setLegalTab('impressum')}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 11, color: 'var(--text-muted)', fontFamily: 'inherit',
          letterSpacing: '0.05em', textTransform: 'uppercase',
        }}
      >Impressum</button>
      <button
        onClick={() => setLegalTab('datenschutz')}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 11, color: 'var(--text-muted)', fontFamily: 'inherit',
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
