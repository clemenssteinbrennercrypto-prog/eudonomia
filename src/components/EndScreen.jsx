import { useState, useMemo } from 'react'
import { updateSession, loadSessions } from '../lib/storage'

function fmt(seconds) {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function motivational(pct, distractionEvents, actualSeconds) {
  if (pct >= 85) return 'Peak focus. Outstanding.'
  if (pct >= 75) return 'Strong session.'
  if (pct >= 65 && distractionEvents === 0) return 'Clean run.'
  if (pct >= 65) return 'Solid work.'
  if (pct >= 50) return 'Good effort.'
  if (actualSeconds < 300) return 'Short session — keep going.'
  return 'Every session counts.'
}

function fmtSecond(s) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}

const DISTRACTION_LABELS = {
  phone: 'Phone check',
  yawn: 'Fatigue',
  away: 'Left camera',
  lookingup: 'Daydreaming',
  prolonged: 'Eyes closed',
  default: 'Distracted',
}

export default function EndScreen({ sessionData, onRestart, onShowHistory }) {
  const {
    id,
    actualSeconds        = 0,
    focusedSeconds       = 0,
    distractionEvents    = 0,
    preDriftEvents       = 0,
    preDriftSeconds      = 0,
    longestFocusedStreak = 0,
    timeline             = [],
    completed            = false,
    goal                 = '',
    task                 = '',
    tags                 = [],
    distractionLog       = [],
    plannedDuration      = 0,
  } = sessionData

  const focusPct = actualSeconds > 0 ? Math.round((focusedSeconds / actualSeconds) * 100) : 0
  const [goalAchieved, setGoalAchieved] = useState(null)

  // Personal best detection
  const isPersonalBest = useMemo(() => {
    const prevSessions = loadSessions().filter(s => s.id !== id)
    if (prevSessions.length === 0) return false
    const prevMax = Math.max(...prevSessions.map(s => {
      const a = s.actualSeconds || 0
      return a > 0 ? Math.round(((s.focusedSeconds || 0) / a) * 100) : 0
    }))
    return focusPct > prevMax
  }, [id, focusPct])
  const [copied, setCopied] = useState(false)
  const [shared, setShared] = useState(false)

  function copySummary() {
    const durationMin = Math.round(actualSeconds / 60)
    const text = `Eudaimonia session: ${task || 'Focus'} — ${durationMin}min, ${focusPct}% focused, ${distractionEvents} alerts`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function shareSession() {
    const durationMin = Math.round(actualSeconds / 60)
    const longestStreakMin = Math.round((longestFocusedStreak || 0) / 60)
    const text = [
      '📊 Eudaimonia session',
      `Task: ${task || 'Focus'}`,
      `Duration: ${durationMin} min · Focus: ${focusPct}%`,
      longestStreakMin > 0 ? `Longest streak: ${longestStreakMin} min` : null,
    ].filter(Boolean).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setShared(true)
      setTimeout(() => setShared(false), 2000)
    })
  }

  return (
    <div className="screen-center">
      <div className={`end-content${focusPct >= 80 ? ' end--excellent' : ''}`}>

        {/* Headline */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 6 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.07em', textTransform: 'uppercase', margin: 0 }}>
              {completed ? 'Session complete' : 'Session ended'}
            </p>
            {focusPct >= 85 && (
              <span style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 100, padding: '2px 8px', fontSize: 10, fontWeight: 700, color: '#F59E0B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Elite</span>
            )}
            {focusPct >= 70 && focusPct < 85 && (
              <span style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 100, padding: '2px 8px', fontSize: 10, fontWeight: 700, color: '#22c55e', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Strong</span>
            )}
            {focusPct >= 50 && focusPct < 70 && (
              <span style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 100, padding: '2px 8px', fontSize: 10, fontWeight: 700, color: '#3b82f6', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Good</span>
            )}
          </div>
          {actualSeconds > 0 && (
            <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>
              Started at {new Date(Date.now() - actualSeconds * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          <h1 className="end-headline">{motivational(focusPct, distractionEvents, actualSeconds)}</h1>
        </div>

        {/* Timeline bar */}
        {timeline.length > 0 && (
          <div style={{ width: '100%' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
              Focus timeline
            </p>
            <div style={{
              width: '100%', height: 12,
              borderRadius: 6, overflow: 'hidden',
              display: 'flex', background: '#E8E3DA',
            }}>
              {timeline.map((pt, i) => {
                const s = pt.score != null ? pt.score : (pt.focused ? 80 : 20)
                const r = Math.round(239 - (239 - 34) * (s / 100))
                const g = Math.round(68 + (197 - 68) * (s / 100))
                const b = Math.round(68 - (68 - 94) * (s / 100))
                const color = `rgb(${r},${g},${b})`
                return (
                  <div key={i} style={{
                    flex: 1, background: color, minWidth: 1,
                    borderRadius: i === 0 ? '6px 0 0 6px' : i === timeline.length - 1 ? '0 6px 6px 0' : 0,
                  }} />
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>Start</span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>End</span>
            </div>
          </div>
        )}

        {/* Stats grid */}
        <div className="stats-row" style={{ flexWrap: 'wrap', justifyContent: 'center', rowGap: 32 }}>
          <div className="stat">
            <span className="stat-value">{fmt(actualSeconds)}</span>
            <span className="stat-label">total duration</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-value stat-value-large" style={{ fontSize: 72, color: focusPct >= 60 ? '#22c55e' : focusPct >= 40 ? '#f97316' : '#ef4444' }}>
              {focusPct}%
            </span>
            <span className="stat-label">focused</span>
            {isPersonalBest && (
              <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600, marginTop: 4, display: 'block' }}>
                New best 🏆
              </span>
            )}
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-value">{distractionEvents}</span>
            <span className="stat-label">{distractionEvents === 1 ? 'alert' : 'alerts'}</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-value" style={{ color: preDriftEvents > 0 ? '#f59e0b' : undefined }}>
              {preDriftEvents}
            </span>
            <span className="stat-label">drift risks</span>
            {preDriftSeconds > 0 && (
              <span style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, display: 'block' }}>
                {fmt(preDriftSeconds)}
              </span>
            )}
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-value">{fmt(longestFocusedStreak)}</span>
            <span className="stat-label">longest streak</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-value" style={{ color: '#ef4444' }}>
              {Math.round(Math.max(0, actualSeconds - focusedSeconds) / 60)}m
            </span>
            <span className="stat-label">distracted time</span>
          </div>
        </div>

        {/* Goal section */}
        {goal && (
          <div style={{
            width: '100%', boxSizing: 'border-box',
            background: '#FFFFFF',
            border: '1px solid #E8E3DA',
            borderRadius: 14,
            padding: '16px 18px',
          }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
              Session goal
            </p>
            <p style={{ fontSize: 15, color: '#111827', fontWeight: 500, marginBottom: 12 }}>
              {goal}
            </p>
            {goalAchieved === null ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { setGoalAchieved(true); if (id) updateSession(id, { goalAchieved: true }) }}
                  style={{
                    padding: '8px 18px', fontSize: 13, fontWeight: 600,
                    background: '#22c55e', color: '#fff',
                    border: 'none', borderRadius: 100,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  ✓ Achieved
                </button>
                <button
                  onClick={() => { setGoalAchieved(false); if (id) updateSession(id, { goalAchieved: false }) }}
                  style={{
                    padding: '8px 18px', fontSize: 13, fontWeight: 600,
                    background: 'none', color: '#6b7280',
                    border: '1px solid #e5e7eb', borderRadius: 100,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Not quite
                </button>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: goalAchieved ? '#22c55e' : '#f97316', fontWeight: 600 }}>
                {goalAchieved ? '✓ Goal achieved!' : 'Keep working toward it 💪'}
              </p>
            )}
          </div>
        )}

        {/* Tags */}
        {tags && tags.length > 0 && (
          <div style={{ width: '100%', boxSizing: 'border-box', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tags.map(tag => (
              <span key={tag} style={{
                padding: '4px 12px', borderRadius: 100,
                background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
                color: '#6366f1', fontSize: 12, fontWeight: 500,
              }}>{tag}</span>
            ))}
          </div>
        )}

        {/* Distraction log */}
        {distractionLog.length > 0 && (
          <div style={{ width: '100%', boxSizing: 'border-box' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>
              What distracted you
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {distractionLog.map((ev, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: '#FFFFFF', border: '1px solid #E8E3DA',
                  borderRadius: 10, padding: '8px 14px',
                  fontSize: 13, color: '#374151',
                }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums', color: '#9ca3af', fontSize: 12 }}>
                    {fmtSecond(ev.second)}
                  </span>
                  <span style={{ color: '#d1d5db' }}>·</span>
                  <span style={{ fontWeight: 500 }}>
                    {DISTRACTION_LABELS[ev.reason] ?? DISTRACTION_LABELS.default}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Smart next session suggestion */}
        {actualSeconds > 300 && plannedDuration > 0 && (() => {
          let suggestion = null
          if (focusPct < 50) {
            const mins = Math.round(plannedDuration * 0.75)
            suggestion = `Next time, try ${mins} minutes — a shorter session might keep you sharper.`
          } else if (focusPct > 80) {
            const mins = Math.round(plannedDuration * 1.25)
            suggestion = `You're on a roll. Next time, try ${mins} minutes.`
          }
          return suggestion ? (
            <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', fontStyle: 'italic', margin: 0 }}>
              {suggestion}
            </p>
          ) : null
        })()}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="restart-btn" onClick={onRestart}>
            New Session
          </button>

          <button
            onClick={onShowHistory}
            style={{
              padding: '14px 28px',
              fontSize: 15, fontWeight: 600,
              background: 'transparent',
              color: '#1a2e4a',
              border: '1.5px solid #1a2e4a',
              borderRadius: 14,
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: '0.01em',
            }}
          >
            View History
          </button>
          <button
            onClick={() => onRestart({ task, goal, duration: plannedDuration || 30 })}
            style={{
              padding: '14px 28px',
              fontSize: 15, fontWeight: 600,
              background: 'transparent',
              color: '#1a2e4a',
              border: '1.5px solid #1a2e4a',
              borderRadius: 14,
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: '0.01em',
            }}
          >
            Repeat
          </button>
        </div>
        <button
          onClick={copySummary}
          style={{
            marginTop: 12,
            background: 'none', border: 'none',
            color: copied ? '#22c55e' : '#9ca3af',
            fontSize: 13, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit',
            textDecoration: 'underline', textDecorationColor: 'transparent',
            transition: 'color 0.2s',
          }}
        >
          {copied ? 'Copied!' : 'Copy summary'}
        </button>
        <button
          onClick={shareSession}
          style={{
            marginTop: 4,
            background: 'none', border: 'none',
            color: shared ? '#22c55e' : '#9ca3af',
            fontSize: 13, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit',
            textDecoration: 'underline', textDecorationColor: 'transparent',
            transition: 'color 0.2s',
          }}
        >
          {shared ? 'Copied!' : '📤 Share'}
        </button>

      </div>
    </div>
  )
}
