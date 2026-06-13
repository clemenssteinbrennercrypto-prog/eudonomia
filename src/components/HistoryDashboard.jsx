import { useState, useMemo } from 'react'
import { loadSessions, deleteSession, clearAllSessions, updateSession } from '../lib/storage'

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
      display: 'flex', background: '#E8E3DA', marginTop: 8,
    }}>
      {timeline.map((pt, i) => {
        const s = pt.score != null ? pt.score : (pt.focused ? 80 : 20)
        const color = `hsl(${Math.round(s * 1.2)}, 80%, 50%)`
        return (
          <div key={i} style={{
            flex: 1, minWidth: 1,
            background: color,
          }} />
        )
      })}
    </div>
  )
}

// ── Session note editor ───────────────────────────────────────────────────────
function SessionNote({ session, onNoteUpdate }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.note || '')

  const save = () => {
    updateSession(session.id, { note: draft })
    onNoteUpdate(session.id, draft)
    setEditing(false)
  }

  if (!editing && !session.note) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setEditing(true) }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 12, color: '#9ca3af', padding: 0, fontFamily: 'inherit',
          textDecoration: 'underline', marginTop: 12, display: 'block',
        }}
      >
        + Add note
      </button>
    )
  }

  if (!editing && session.note) {
    return (
      <div
        onClick={(e) => { e.stopPropagation(); setEditing(true) }}
        style={{
          marginTop: 12, padding: '8px 12px',
          background: '#f9fafb', border: '1px solid #e5e7eb',
          borderRadius: 8, fontSize: 13, color: '#374151',
          cursor: 'pointer', lineHeight: 1.5,
        }}
        title="Click to edit note"
      >
        {session.note}
      </div>
    )
  }

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 12 }}>
      <textarea
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Add a note… e.g. had coffee, felt distracted"
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '8px 12px', fontSize: 13, fontFamily: 'inherit',
          border: '1px solid #e5e7eb', borderRadius: 8,
          background: '#fff', color: '#374151', resize: 'vertical',
          outline: 'none', lineHeight: 1.5,
        }}
        autoFocus
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button
          onClick={save}
          style={{
            padding: '5px 14px', fontSize: 12, fontWeight: 600,
            background: '#1a2e4a', color: '#fff', border: 'none',
            borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >Save</button>
        <button
          onClick={() => { setDraft(session.note || ''); setEditing(false) }}
          style={{
            padding: '5px 14px', fontSize: 12, fontWeight: 600,
            background: 'none', color: '#6b7280',
            border: '1px solid #e5e7eb', borderRadius: 8,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >Cancel</button>
      </div>
    </div>
  )
}

// ── Session card ──────────────────────────────────────────────────────────────
function SessionCard({ session, onDelete, onExpand, expanded, onNoteUpdate }) {
  const focusPct = session.actualSeconds > 0
    ? Math.round((session.focusedSeconds / session.actualSeconds) * 100)
    : 0
  const color = focusColor(focusPct)

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: `1.5px solid ${expanded ? '#1a2e4a' : '#E8E3DA'}`,
        borderLeft: `4px solid ${focusPct >= 70 ? '#22c55e' : focusPct >= 40 ? '#f97316' : '#ef4444'}`,
        borderRadius: 16,
        padding: '20px 22px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: expanded ? '0 4px 20px rgba(0,0,0,0.07)' : 'none',
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
        fontSize: 12, color: '#6b7280', flexWrap: 'wrap', rowGap: 6,
      }}>
        <span>{fmt(session.actualSeconds)}</span>
        <span>{motivational(focusPct)}</span>
        <span>{session.distractionEvents ?? 0} alert{(session.distractionEvents ?? 0) !== 1 ? 's' : ''}</span>
        <span>{fmt(session.longestFocusedStreak)} streak</span>
        {session.completed && <span style={{ color: '#22c55e' }}>Completed</span>}
      </div>

      <MiniTimeline timeline={session.timeline} />

      {/* Note preview (collapsed) */}
      {!expanded && session.note && (
        <div style={{
          marginTop: 10, padding: '7px 10px',
          background: '#f9fafb', border: '1px solid #e5e7eb',
          borderRadius: 8, fontSize: 12, color: '#6b7280',
          lineHeight: 1.5,
        }}>
          {session.note}
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          marginTop: 20,
          paddingTop: 20,
          borderTop: '1px solid #f1f5f9',
        }}>
          {/* Big stats */}
          <div className="history-stats-grid" style={{ textAlign: 'center' }}>
            {[
              { label: 'Total time', value: fmt(session.actualSeconds) },
              { label: 'Focus %', value: `${focusPct}%`, color },
              ...(session.finalScore != null ? [{ label: 'Focus score', value: session.finalScore, color }] : []),
              { label: 'Alerts', value: session.distractionEvents ?? 0 },
              { label: 'Best streak', value: fmt(session.longestFocusedStreak) },
            ].map((s) => (
              <div key={s.label} style={{
                background: '#F5F4F0', borderRadius: 12, padding: '14px 8px',
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

          {/* Session note */}
          <SessionNote session={session} onNoteUpdate={onNoteUpdate} />

          {/* Full timeline */}
          {session.timeline?.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                Focus timeline
              </p>
              <div style={{
                width: '100%', height: 10, borderRadius: 5, overflow: 'hidden',
                display: 'flex', background: '#E8E3DA',
              }}>
                {session.timeline.map((pt, i) => {
                  const s = pt.score != null ? pt.score : (pt.focused ? 80 : 20)
                  const color = `hsl(${Math.round(s * 1.2)}, 80%, 50%)`
                  return (
                    <div key={i} style={{
                      flex: 1, minWidth: 2,
                      background: color,
                    }} />
                  )
                })}
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

// ── CHANGE 3: Smarter overall stats ──────────────────────────────────────────
function computeCurrentStreak(sessions) {
  // Count consecutive days (backwards from today) that have at least 1 session
  if (!sessions.length) return 0
  const today = new Date(); today.setHours(0,0,0,0)
  let streak = 0
  let cursor = new Date(today)
  const daySet = new Set(sessions.map(s => new Date(s.timestamp).toDateString()))
  while (daySet.has(cursor.toDateString())) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

function OverallStats({ sessions }) {
  const stats = useMemo(() => {
    if (!sessions.length) return null
    // 1. Total focused seconds (not actual seconds)
    const totalFocusTime = sessions.reduce((a, s) => a + (s.focusedSeconds ?? 0), 0)
    // 2. Rolling avg focus %
    const avgFocus = Math.round(
      sessions.reduce((a, s) => a + (s.actualSeconds > 0 ? (s.focusedSeconds / s.actualSeconds) * 100 : 0), 0) / sessions.length
    )
    // 3. Current day streak
    const currentStreak = computeCurrentStreak(sessions)
    // 4. Best single session focus %
    const bestSession = sessions.reduce((best, s) => {
      const pct = s.actualSeconds > 0 ? (s.focusedSeconds / s.actualSeconds) * 100 : 0
      return pct > (best.pct ?? -1) ? { ...s, pct } : best
    }, {})
    const bestPct = Math.round(bestSession.pct ?? 0)
    return { totalFocusTime, avgFocus, currentStreak, bestPct }
  }, [sessions])

  if (!stats) return null

  return (
    <div style={{
      display: 'grid',
      gap: 12,
      marginBottom: 32,
    }}
      className="history-stats-grid"
    >
      {[
        { label: 'Total focus time',  value: fmt(stats.totalFocusTime) },
        { label: 'Avg focus %',       value: `${stats.avgFocus}%`,   color: focusColor(stats.avgFocus) },
        { label: 'Current streak',    value: `${stats.currentStreak}d` },
        { label: 'Best session',      value: `${stats.bestPct}%`,    color: focusColor(stats.bestPct) },
      ].map((s) => (
        <div key={s.label} style={{
          background: '#FFFFFF',
          border: 'none',
          borderRadius: 16,
          padding: '18px 16px',
          textAlign: 'center',
          boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
        }}>
          <p style={{
            fontSize: 28, fontWeight: 300, letterSpacing: '-0.025em',
            color: s.color ?? '#1A1A1A', marginBottom: 6,
          }}>
            {s.value}
          </p>
          <p style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            {s.label}
          </p>
        </div>
      ))}
    </div>
  )
}

// ── CHANGE 1: Group sessions by date ─────────────────────────────────────────
function groupByDate(sessions) {
  const today     = new Date(); today.setHours(0,0,0,0)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)

  const groups = []
  const seen = {}

  for (const s of sessions) {
    const d = new Date(s.timestamp); d.setHours(0,0,0,0)
    let label
    if (d.getTime() === today.getTime())     label = 'Today'
    else if (d.getTime() === yesterday.getTime()) label = 'Yesterday'
    else label = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })

    if (!seen[label]) { seen[label] = true; groups.push({ label, sessions: [] }) }
    groups[groups.length - 1].sessions.push(s)
  }
  return groups
}

// ── CHANGE 2: Weekly trend bar chart ─────────────────────────────────────────
function getLast7Days(sessions) {
  const days = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(0,0,0,0)
    const label = d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3)
    const dateStr = d.toDateString()
    const ds = sessions.filter(s => new Date(s.timestamp).toDateString() === dateStr)
    let avgFocus = null
    if (ds.length > 0) {
      avgFocus = Math.round(
        ds.reduce((a, s) => a + (s.actualSeconds > 0 ? (s.focusedSeconds / s.actualSeconds) * 100 : 0), 0) / ds.length
      )
    }
    days.push({ label, avgFocus })
  }
  return days
}

function WeeklyTrends({ sessions }) {
  const days = useMemo(() => getLast7Days(sessions), [sessions])
  const MAX_H = 48

  return (
    <div style={{
      background: '#FFFFFF',
      borderRadius: 16,
      padding: '20px 20px 16px',
      boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
      marginBottom: 24,
    }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16, margin: '0 0 16px' }}>
        Last 7 days
      </p>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
        {days.map((day, i) => {
          const filled = day.avgFocus !== null
          const h = filled ? Math.max(4, Math.round((day.avgFocus / 100) * MAX_H)) : 4
          const color = filled ? focusColor(day.avgFocus) : '#E8E3DA'
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: filled ? '#6b7280' : 'transparent' }}>
                {filled ? `${day.avgFocus}%` : '0'}
              </span>
              <div style={{ height: 70, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', width: '100%' }}>
                <div style={{
                  width: '100%', height: h,
                  background: color,
                  borderRadius: '6px 6px 0 0',
                  minHeight: 4,
                  transition: 'height 0.3s ease',
                }} />
              </div>
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
  const [dateFilter, setDateFilter] = useState('all') // 'all' | 'week' | 'month'
  const [search, setSearch] = useState('')

  const filteredSessions = useMemo(() => {
    let result = sessions
    if (dateFilter !== 'all') {
      const now = new Date()
      const cutoff = new Date(now)
      if (dateFilter === 'week') cutoff.setDate(now.getDate() - 7)
      else if (dateFilter === 'month') cutoff.setDate(now.getDate() - 30)
      result = result.filter(s => new Date(s.timestamp) >= cutoff)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(s => (s.task || '').toLowerCase().includes(q))
    }
    return result
  }, [sessions, dateFilter, search])

  const groupedSessions = useMemo(() => groupByDate(filteredSessions), [filteredSessions])

  const handleDelete = (id) => {
    deleteSession(id)
    setSessions(loadSessions())
    if (expandedId === id) setExpandedId(null)
  }

  const handleNoteUpdate = (id, note) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, note } : s))
  }

  const handleClearAll = () => {
    clearAllSessions()
    setSessions([])
    setConfirmClear(false)
  }

  const handleExportCSV = () => {
    const header = ['timestamp', 'task', 'durationSeconds', 'focusPct', 'distractionEvents', 'longestStreakSeconds']
    const rows = sessions.map(s => {
      const focusPct = s.actualSeconds > 0
        ? Math.round((s.focusedSeconds / s.actualSeconds) * 100)
        : 0
      return [
        new Date(s.timestamp).toISOString(),
        `"${(s.task || '').replace(/"/g, '""')}"`,
        s.actualSeconds ?? 0,
        focusPct,
        s.distractionEvents ?? 0,
        s.longestFocusedStreak ?? 0,
      ].join(',')
    })
    const csv = [header.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `eudaimonia-sessions-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#F5F4F0',
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
              {sessions.length} session{sessions.length !== 1 ? 's' : ''} · {fmt(sessions.reduce((a, s) => a + (s.focusedSeconds ?? 0), 0))} total focused
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
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <p style={{ fontSize: 32, fontWeight: 300, color: '#1A1A1A', margin: 0 }}>
              No sessions yet
            </p>
            <p style={{ fontSize: 14, color: '#9ca3af', marginTop: 8 }}>
              Complete your first focus session to see your stats here.
            </p>
            <button
              onClick={onClose}
              style={{
                marginTop: 24,
                border: '1.5px solid #E8E3DA',
                borderRadius: 100,
                padding: '10px 24px',
                fontSize: 14, color: '#6B7280',
                background: 'transparent',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Start your first session →
            </button>
          </div>
        ) : (
          <>
            <WeeklyTrends sessions={sessions} />
            <OverallStats sessions={sessions} />

            {/* Date filter pills */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {[['all','All time'],['week','This week'],['month','This month']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setDateFilter(val)}
                  style={{
                    border: dateFilter === val ? '1.5px solid #1a2e4a' : '1.5px solid #E8E3DA',
                    borderRadius: 100, padding: '6px 16px',
                    fontSize: 12, fontWeight: 600,
                    background: dateFilter === val ? '#1a2e4a' : 'transparent',
                    color: dateFilter === val ? '#fff' : '#6B7280',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >{label}</button>
              ))}
            </div>

            {/* Search filter */}
            <div style={{ position: 'relative', marginBottom: 20 }}>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search sessions..."
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '8px 32px 8px 12px',
                  background: '#f9fafb', border: '1.5px solid #E8E3DA',
                  borderRadius: 10, fontSize: 13, color: '#1a2e4a',
                  fontFamily: 'inherit', outline: 'none',
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  style={{
                    position: 'absolute', right: 10, top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none', border: 'none',
                    color: '#9ca3af', fontSize: 14, cursor: 'pointer',
                    lineHeight: 1, padding: 0,
                  }}
                >×</button>
              )}
            </div>

            {/* CHANGE 1: Date-grouped session list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {groupedSessions.map(group => (
                <div key={group.label}>
                  <p style={{
                    fontSize: 11, fontWeight: 700, color: '#9ca3af',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    margin: '0 0 8px',
                  }}>
                    {group.label}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {group.sessions.map(s => (
                      <SessionCard
                        key={s.id}
                        session={s}
                        onDelete={handleDelete}
                        onExpand={handleExpand}
                        expanded={expandedId === s.id}
                        onNoteUpdate={handleNoteUpdate}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 40, textAlign: 'center' }}>
              {!confirmClear ? (
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button
                    onClick={handleExportCSV}
                    style={{
                      background: 'none', border: '1px solid #e5e7eb',
                      color: '#9ca3af', fontSize: 13, padding: '8px 20px',
                      borderRadius: 100, cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'color 0.15s, border-color 0.15s',
                    }}
                  >
                    Export CSV
                  </button>
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
                </div>
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
