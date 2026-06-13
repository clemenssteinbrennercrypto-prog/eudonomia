import { useState, useMemo } from 'react'
import { loadSessions, deleteSession, clearAllSessions } from '../lib/storage'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(seconds) {
  if (!seconds || seconds < 0) return '0s'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function fmtDate(ts) {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function fmtTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function focusColor(pct) {
  if (pct >= 70) return '#22c55e'
  if (pct >= 40) return '#f97316'
  return '#ef4444'
}

function motivational(pct) {
  if (pct >= 80) return 'Outstanding'
  if (pct >= 60) return 'Solid'
  if (pct >= 40) return 'Getting there'
  return 'Keep going'
}

// ── Mini timeline bar ─────────────────────────────────────────────────────────
function MiniTimeline({ timeline }) {
  if (!timeline?.length) return null
  return (
    <div style={{
      width: '100%', height: 5, borderRadius: 3, overflow: 'hidden',
      display: 'flex', background: '#f1f5f9', marginTop: 8,
    }}>
      {timeline.map((pt, i) => (
        <div key={i} style={{
          flex: 1, minWidth: 1,
          background: pt.focused ? '#22c55e' : '#ef4444',
        }} />
      ))}
    </div>
  )
}

// ── Session card ──────────────────────────────────────────────────────────────
function SessionCard({ session, onDelete, onExpand, expanded }) {
  const focusPct = session.actualSeconds > 0
    ? Math.round((session.focusedSeconds / session.actualSeconds) * 100)
    : 0
  const color = focusColor(focusPct)

  return (
    <div
      style={{
        background: '#fff',
        border: '1.5px solid #e5e7eb',
        borderRadius: 16,
        padding: '20px 22px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: expanded ? '0 4px 20px rgba(0,0,0,0.07)' : 'none',
        borderColor: expanded ? '#1a2e4a' : '#e5e7eb',
      }}
      onClick={() => onExpand(session.id)}
    >
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 3 }}>
            {session.task || 'Untitled session'}
          </p>
          <p style={{ fontSize: 12, color: '#9ca3af' }}>
            {fmtDate(session.timestamp)} · {fmtTime(session.timestamp)}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            background: color + '18',
            border: `1px solid ${color}40`,
            borderRadius: 100,
            padding: '4px 12px',
            fontSize: 12,
            fontWeight: 700,
            color,
          }}>
            {focusPct}% focused
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(session.id) }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#d1d5db', fontSize: 16, lineHeight: 1, padding: '2px 4px',
              borderRadius: 6, transition: 'color 0.15s',
            }}
            title="Delete"
          >
            ×
          </button>
        </div>
      </div>

      {/* Quick stats row */}
      <div style={{
        display: 'flex', gap: 20, marginTop: 14,
        fontSize: 12, color: '#6b7280',
      }}>
        <span>⏱ {fmt(session.actualSeconds)}</span>
        <span>🎯 {motivational(focusPct)}</span>
        <span>🔔 {session.distractionEvents ?? 0} alert{(session.distractionEvents ?? 0) !== 1 ? 's' : ''}</span>
        <span>🔥 {fmt(session.longestFocusedStreak)} streak</span>
        {session.completed && <span style={{ color: '#22c55e' }}>✓ Completed</span>}
      </div>

      <MiniTimeline timeline={session.timeline} />

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          marginTop: 20,
          paddingTop: 20,
          borderTop: '1px solid #f1f5f9',
        }}>
          {/* Big stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 16,
            textAlign: 'center',
          }}>
            {[
              { label: 'Total time', value: fmt(session.actualSeconds) },
              { label: 'Focused', value: `${focusPct}%`, color },
              { label: 'Alerts', value: session.distractionEvents ?? 0 },
              { label: 'Best streak', value: fmt(session.longestFocusedStreak) },
            ].map((s) => (
              <div key={s.label} style={{
                background: '#f9fafb', borderRadius: 12, padding: '14px 8px',
              }}>
                <p style={{
                  fontSize: 22, fontWeight: 300,
                  color: s.color ?? '#111827',
                  letterSpacing: '-0.02em',
                  marginBottom: 4,
                }}>
                  {s.value}
                </p>
                <p style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>
                  {s.label}
                </p>
              </div>
            ))}
          </div>

          {/* Full timeline */}
          {session.timeline?.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                Focus timeline
              </p>
              <div style={{
                width: '100%', height: 10, borderRadius: 5, overflow: 'hidden',
                display: 'flex', background: '#f1f5f9',
              }}>
                {session.timeline.map((pt, i) => (
                  <div key={i} style={{
                    flex: 1, minWidth: 2,
                    background: pt.focused ? '#22c55e' : '#ef4444',
                  }} />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>Start</span>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>End</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Summary stats at top ──────────────────────────────────────────────────────
function OverallStats({ sessions }) {
  const stats = useMemo(() => {
    if (!sessions.length) return null
    const totalTime = sessions.reduce((a, s) => a + (s.actualSeconds ?? 0), 0)
    const avgFocus = Math.round(
      sessions.reduce((a, s) => {
        const pct = s.actualSeconds > 0 ? (s.focusedSeconds / s.actualSeconds) * 100 : 0
        return a + pct
      }, 0) / sessions.length
    )
    const bestStreak = Math.max(...sessions.map((s) => s.longestFocusedStreak ?? 0))
    const completed = sessions.filter((s) => s.completed).length
    return { totalTime, avgFocus, bestStreak, completed }
  }, [sessions])

  if (!stats) return null

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 12,
      marginBottom: 32,
    }}>
      {[
        { label: 'Total focus time', value: fmt(stats.totalTime) },
        { label: 'Avg focus %', value: `${stats.avgFocus}%`, color: focusColor(stats.avgFocus) },
        { label: 'Best streak ever', value: fmt(stats.bestStreak) },
        { label: 'Sessions completed', value: `${stats.completed}/${sessions.length}` },
      ].map((s) => (
        <div key={s.label} style={{
          background: '#f9fafb',
          border: '1px solid #e5e7eb',
          borderRadius: 14,
          padding: '18px 16px',
          textAlign: 'center',
        }}>
          <p style={{
            fontSize: 28, fontWeight: 300, letterSpacing: '-0.025em',
            color: s.color ?? '#111827', marginBottom: 6,
          }}>
            {s.value}
          </p>
          <p style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>
            {s.label}
          </p>
        </div>
      ))}
    </div>
  )
}

// ── Weekly Trends chart ───────────────────────────────────────────────────────
function WeeklyTrends({ sessions }) {
  const days = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const label = d.toLocaleDateString('en-US', { weekday: 'short' })
    const dateStr = d.toDateString()
    const daySessions = sessions.filter(s => new Date(s.timestamp).toDateString() === dateStr)
    let avgFocus = null
    if (daySessions.length > 0) {
      avgFocus = Math.round(
        daySessions.reduce((a, s) => {
          const pct = s.actualSeconds > 0 ? (s.focusedSeconds / s.actualSeconds) * 100 : 0
          return a + pct
        }, 0) / daySessions.length
      )
    }
    days.push({ label, avgFocus })
  }

  const maxH = 60
  const barW = 32

  return (
    <div style={{ marginBottom: 32 }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12 }}>
        7-Day Focus Trend
      </p>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: maxH + 28 }}>
        {days.map((day, i) => {
          const filled = day.avgFocus !== null
          const h = filled ? Math.max(4, Math.round((day.avgFocus / 100) * maxH)) : 4
          const color = !filled
            ? '#e2e8f0'
            : day.avgFocus >= 70 ? '#22c55e'
            : day.avgFocus >= 40 ? '#f97316'
            : '#ef4444'

          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1 }}>
              {filled && (
                <span style={{ fontSize: 10, color: '#6b7280', fontWeight: 600 }}>{day.avgFocus}%</span>
              )}
              {!filled && <span style={{ fontSize: 10, color: 'transparent' }}>0%</span>}
              <div style={{
                width: '100%', maxWidth: barW,
                height: h,
                background: color,
                borderRadius: 4,
                transition: 'height 0.3s ease',
              }} />
              <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 500 }}>{day.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function HistoryDashboard({ onClose }) {
  const [sessions, setSessions] = useState(() => loadSessions())
  const [expandedId, setExpandedId] = useState(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const handleDelete = (id) => {
    deleteSession(id)
    setSessions(loadSessions())
    if (expandedId === id) setExpandedId(null)
  }

  const handleClearAll = () => {
    clearAllSessions()
    setSessions([])
    setConfirmClear(false)
  }

  const handleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#fff',
      overflowY: 'auto',
      zIndex: 200,
    }}>
      <div style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '48px 24px 80px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.025em', color: '#111827' }}>
              Session History
            </h1>
            <p style={{ fontSize: 14, color: '#9ca3af', marginTop: 4 }}>
              {sessions.length} session{sessions.length !== 1 ? 's' : ''} recorded
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '9px 22px',
              fontSize: 14, fontWeight: 600,
              background: '#1a2e4a', color: '#fff',
              border: 'none', borderRadius: 12,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            ← Back
          </button>
        </div>

        {sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#9ca3af' }}>
            <p style={{ fontSize: 40, marginBottom: 16 }}>📊</p>
            <p style={{ fontSize: 18, fontWeight: 500, color: '#6b7280' }}>No sessions yet</p>
            <p style={{ fontSize: 14, marginTop: 8 }}>Complete your first focus session to see your data here.</p>
          </div>
        ) : (
          <>
            <WeeklyTrends sessions={sessions} />
            <OverallStats sessions={sessions} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  onDelete={handleDelete}
                  onExpand={handleExpand}
                  expanded={expandedId === s.id}
                />
              ))}
            </div>

            <div style={{ marginTop: 40, textAlign: 'center' }}>
              {!confirmClear ? (
                <button
                  onClick={() => setConfirmClear(true)}
                  style={{
                    background: 'none', border: '1px solid #e5e7eb',
                    color: '#9ca3af', fontSize: 13, padding: '8px 20px',
                    borderRadius: 100, cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'color 0.15s, border-color 0.15s',
                  }}
                >
                  Clear all history
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#6b7280' }}>Are you sure?</span>
                  <button
                    onClick={handleClearAll}
                    style={{
                      background: '#ef4444', color: '#fff', border: 'none',
                      fontSize: 13, padding: '8px 18px', borderRadius: 100,
                      cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                    }}
                  >
                    Yes, delete all
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    style={{
                      background: 'none', border: '1px solid #e5e7eb',
                      color: '#6b7280', fontSize: 13, padding: '8px 18px',
                      borderRadius: 100, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
