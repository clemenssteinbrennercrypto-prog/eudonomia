import { useState, useMemo } from 'react'
import { loadSessions, deleteSession, clearAllSessions, updateSession } from '../lib/storage'
import { calibrate } from '../lib/calibration'
import { summarizeSessionAlignment } from '../lib/sessionIntent'

function hasMeasuredFocus(session) {
  if (!session || session.scoreMeasured === false) return false
  if (session.trackingFaulted && session.avgFocusScore == null && session.finalScore == null) return false
  return session.actualSeconds > 0 && session.focusedSeconds != null
}

function sessionFocusPct(session) {
  return hasMeasuredFocus(session)
    ? Math.round((session.focusedSeconds / session.actualSeconds) * 100)
    : null
}

// ── Month Calendar ─────────────────────────────────────────────────────────────
function MonthCalendar({ sessions, onDayClick, selectedDay }) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const firstDay = new Date(year, month, 1).getDay() // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  // Build day → avg focus map
  const dayMap = useMemo(() => {
    const map = {}
    for (const s of sessions) {
      const d = new Date(s.timestamp)
      if (d.getFullYear() !== year || d.getMonth() !== month) continue
      const key = d.getDate()
      const pct = sessionFocusPct(s)
      if (pct == null) continue
      if (!map[key]) map[key] = []
      map[key].push(pct)
    }
    const result = {}
    for (const [k, arr] of Object.entries(map)) {
      result[k] = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
    }
    return result
  }, [sessions, year, month])

  function dayColor(avg) {
    if (avg === undefined) return 'rgba(122,152,255,0.06)'
    if (avg >= 70) return 'rgba(47,227,168,0.20)'
    if (avg >= 45) return 'rgba(255,179,64,0.20)'
    return 'rgba(255,77,106,0.20)'
  }
  function dayTextColor(avg) {
    if (avg === undefined) return 'var(--text-muted)'
    if (avg >= 70) return 'var(--good)'
    if (avg >= 45) return 'var(--warn)'
    return 'var(--bad)'
  }

  const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const dayLabels = ['Su','Mo','Tu','We','Th','Fr','Sa']

  // Build grid cells: blanks + days
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const selectedDateStr = selectedDay
    ? new Date(year, month, selectedDay).toDateString()
    : null

  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {monthName}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {dayLabels.map(l => (
          <div key={l} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', paddingBottom: 4 }}>{l}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`blank-${i}`} />
          const avg = dayMap[day]
          const isSelected = selectedDay === day
          return (
            <div
              key={day}
              onClick={() => onDayClick(day === selectedDay ? null : day)}
              title={avg !== undefined ? `${avg}% focus` : 'No sessions'}
              style={{
                aspectRatio: '1',
                borderRadius: 6,
                background: dayColor(avg),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 600,
                color: dayTextColor(avg),
                cursor: avg !== undefined ? 'pointer' : 'default',
                border: isSelected ? '2px solid var(--ultra)' : '2px solid transparent',
                boxSizing: 'border-box',
              }}
            >
              {day}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(47,227,168,0.18)', display: 'inline-block' }}/> ≥70% focus</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(255,179,64,0.18)', display: 'inline-block' }}/> 45–70%</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(255,77,106,0.18)', display: 'inline-block' }}/> &lt;45%</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(122,152,255,0.06)', display: 'inline-block' }}/> none</span>
      </div>
    </div>
  )
}

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

function relativeTime(ts) {
  const now = Date.now()
  const diff = now - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins || 1} ${mins === 1 ? 'minute' : 'minutes'} ago`
  const today = new Date(); today.setHours(0,0,0,0)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const d = new Date(ts); d.setHours(0,0,0,0)
  const time = fmtTime(ts)
  if (d.getTime() === today.getTime()) return `Today, ${time}`
  if (d.getTime() === yesterday.getTime()) return `Yesterday, ${time}`
  return null // fall back to existing format
}

function fmtTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function focusColor(pct) {
  if (pct == null) return 'var(--text-muted)'
  if (pct >= 70) return 'var(--good)'
  if (pct >= 40) return 'var(--warn)'
  return 'var(--bad)'
}

function motivational(pct) {
  if (pct == null) return 'Not measured'
  if (pct >= 80) return 'Outstanding'
  if (pct >= 60) return 'Solid'
  if (pct >= 40) return 'Getting there'
  return 'Keep going'
}

function normalizedOutcome(session) {
  if (session.goalOutcome) return session.goalOutcome
  if (session.goalAchieved === true) return 'yes'
  if (session.goalAchieved === false) return 'no'
  return null
}

const PHASE_LABELS = {
  arrival: 'Arrival',
  ramp: 'Ramp',
  lock_in: 'Lock-in',
  fade: 'Fade',
  recovery: 'Recovery',
  drift: 'Drift',
}

const PHASE_COLORS = {
  arrival: '#5BC8FF',
  ramp: 'var(--good)',
  lock_in: '#B79CFF',
  fade: 'var(--warn)',
  recovery: '#fb7185',
  drift: 'var(--bad)',
}

function dominantEntry(counts = {}) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || null
}

function phaseInsight(session, focusPct) {
  if (focusPct == null) return 'No measured focus score was saved for this session.'
  const phaseSeconds = session.focusPhases?.seconds || {}
  const dominant = session.focusPhases?.dominant || dominantEntry(phaseSeconds)?.[0] || null
  const fadeDrift = (phaseSeconds.fade || 0) + (phaseSeconds.drift || 0)
  const lockIn = phaseSeconds.lock_in || 0
  const alignment = summarizeSessionAlignment(session.activityAlignment, session.actualSeconds || 0)
  if (alignment.observedSeconds >= 60 && alignment.driftPct >= 30) {
    return `Goal drift: ${alignment.driftPct}% off-goal or blocked activity.`
  }
  if (lockIn >= 90 && fadeDrift < 60) return `Clean lock-in: ${fmt(lockIn)} with little fade.`
  if (fadeDrift >= 90) return `Fade/drift tail: ${fmt(fadeDrift)} below stable focus.`
  if ((session.preDriftEvents || 0) > 0) return `${session.preDriftEvents} drift-risk cue${session.preDriftEvents === 1 ? '' : 's'} before full alerts.`
  if (dominant) return `Mostly ${PHASE_LABELS[dominant] || dominant.toLowerCase()} phase.`
  return focusPct >= 70 ? 'Stable session shape.' : 'No strong phase pattern saved.'
}

// ── Mini timeline bar ─────────────────────────────────────────────────────────
function MiniTimeline({ timeline }) {
  if (!timeline?.length) return null
  return (
    <div style={{
      width: '100%', height: 5, borderRadius: 3, overflow: 'hidden',
      display: 'flex', background: 'rgba(122,152,255,0.08)', marginTop: 8,
    }}>
      {timeline.map((pt, i) => {
        const s = pt.score != null ? pt.score : (pt.focused ? 80 : 20)
        const color = `hsl(${Math.round(s * 1.2)}, 80%, 50%)`
        return (
          <div key={i} style={{
            flex: 1, minWidth: 1,
            background: color,
            borderBottom: pt.phase ? `2px solid ${PHASE_COLORS[pt.phase] || 'var(--text-muted)'}` : 'none',
            opacity: pt.preDrift ? 0.6 : 1,
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
          fontSize: 12, color: 'var(--text-muted)', padding: 0, fontFamily: 'inherit',
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
          background: 'rgba(122,152,255,0.05)', border: '1px solid var(--line)',
          borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)',
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
          border: '1px solid var(--line)', borderRadius: 8,
          background: 'var(--surface)', color: 'var(--text-secondary)', resize: 'vertical',
          outline: 'none', lineHeight: 1.5,
        }}
        autoFocus
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button
          onClick={save}
          style={{
            padding: '5px 14px', fontSize: 12, fontWeight: 600,
            background: 'var(--ultra)', color: 'var(--text)', border: 'none',
            borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >Save</button>
        <button
          onClick={() => { setDraft(session.note || ''); setEditing(false) }}
          style={{
            padding: '5px 14px', fontSize: 12, fontWeight: 600,
            background: 'none', color: 'var(--text-muted)',
            border: '1px solid var(--line)', borderRadius: 8,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >Cancel</button>
      </div>
    </div>
  )
}

// ── Session card ──────────────────────────────────────────────────────────────
function SessionCard({ session, prevSession, onDelete, onExpand, expanded, onNoteUpdate }) {
  const focusPct = sessionFocusPct(session)
  const prevFocusPct = sessionFocusPct(prevSession)
  const color = focusColor(focusPct)
  const outcomeLabel = session.goalOutcome === 'yes'
    ? 'Goal reached'
    : session.goalOutcome === 'partly'
      ? 'Partly reached'
      : session.goalOutcome === 'no'
        ? 'Goal missed'
        : null

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: `1.5px solid ${expanded ? 'var(--ultra)' : 'var(--line)'}`,
        borderLeft: `4px solid ${focusPct == null ? 'var(--line-strong)' : focusPct >= 70 ? 'var(--good)' : focusPct >= 40 ? 'var(--warn)' : 'var(--bad)'}`,
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
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
            {session.task || 'Untitled session'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {relativeTime(session.timestamp) || `${fmtDate(session.timestamp)} · ${fmtTime(session.timestamp)}`}
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
            {focusPct == null ? 'Not measured' : `${focusPct}% focused`}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(session.id) }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--line-strong)', fontSize: 16, lineHeight: 1, padding: '2px 4px',
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
        fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap', rowGap: 6,
      }}>
        <span>{fmt(session.actualSeconds)}</span>
        <span>{motivational(focusPct)}</span>
        <span>{session.distractionEvents ?? 0} alert{(session.distractionEvents ?? 0) !== 1 ? 's' : ''}</span>
        <span>{fmt(session.longestFocusedStreak)} streak</span>
        {session.energyLevel && <span>{session.energyLevel} energy</span>}
        {outcomeLabel && <span>{outcomeLabel}</span>}
        {session.completed && <span style={{ color: 'var(--good)' }}>Completed</span>}
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.4 }}>
        {phaseInsight(session, focusPct)}
      </p>

      <MiniTimeline timeline={session.timeline} />

      {/* Tags */}
      {session.tags && session.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
          {session.tags.map(tag => (
            <span key={tag} style={{
              padding: '2px 10px', borderRadius: 100,
              background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
              color: '#6366f1', fontSize: 11, fontWeight: 500,
            }}>{tag}</span>
          ))}
        </div>
      )}

      {/* Note preview (collapsed) */}
      {!expanded && session.note && (
        <div style={{
          marginTop: 10, padding: '7px 10px',
          background: 'rgba(122,152,255,0.05)', border: '1px solid var(--line)',
          borderRadius: 8, fontSize: 12, color: 'var(--text-muted)',
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
              { label: 'Focus %', value: focusPct == null ? '--' : `${focusPct}%`, color },
              ...(session.finalScore != null ? [{ label: 'Focus score', value: session.finalScore, color }] : []),
              { label: 'Alerts', value: session.distractionEvents ?? 0 },
              { label: 'Best streak', value: fmt(session.longestFocusedStreak) },
            ].map((s) => (
              <div key={s.label} style={{
                background: 'var(--bg)', borderRadius: 12, padding: '14px 8px',
              }}>
                <p style={{
                  fontSize: 22, fontWeight: 300,
                  color: s.color ?? 'var(--text)',
                  letterSpacing: '-0.02em',
                  marginBottom: 4,
                }}>
                  {s.value}
                </p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>
                  {s.label}
                </p>
              </div>
            ))}
          </div>

          {/* vs last session comparison */}
          {prevSession != null && prevFocusPct != null && (
            <div style={{
              marginTop: 14,
              padding: '10px 14px',
              background: 'var(--bg)',
              borderRadius: 10,
              display: 'flex',
              gap: 16,
              flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginRight: 4 }}>vs last</span>
              {(() => {
                if (focusPct == null || prevFocusPct == null) {
                  return (
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      Focus comparison unavailable
                    </span>
                  )
                }
                const focusDiff = focusPct - prevFocusPct
                const durDiff = (session.actualSeconds ?? 0) - (prevSession.actualSeconds ?? 0)
                const alertsDiff = (session.distractionEvents ?? 0) - (prevSession.distractionEvents ?? 0)
                const sign = (n) => n > 0 ? '+' : ''
                const color = (n, invert = false) => n === 0 ? 'var(--text-muted)' : (n > 0) !== invert ? 'var(--good)' : 'var(--bad)'
                const fmtDur = (s) => {
                  const abs = Math.abs(s)
                  const m = Math.floor(abs / 60), sec = abs % 60
                  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
                }
                return (
                  <>
                    <span style={{ fontSize: 13, color: color(focusDiff) }}>
                      {sign(focusDiff)}{focusDiff}% focus
                    </span>
                    <span style={{ fontSize: 13, color: color(durDiff) }}>
                      {durDiff >= 0 ? '+' : '-'}{fmtDur(durDiff)} duration
                    </span>
                    <span style={{ fontSize: 13, color: color(alertsDiff, true) }}>
                      {sign(alertsDiff)}{alertsDiff} alerts
                    </span>
                  </>
                )
              })()}
            </div>
          )}

          {/* Session note */}
          <SessionNote session={session} onNoteUpdate={onNoteUpdate} />

          {(session.intendedOutput || session.successCriteria || session.completedText || session.blockerText) && (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                Intention and output
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                {session.intendedOutput && <p style={{ margin: 0 }}><strong>Output:</strong> {session.intendedOutput}</p>}
                {session.successCriteria && <p style={{ margin: 0 }}><strong>Success:</strong> {session.successCriteria}</p>}
                {session.completedText && <p style={{ margin: 0 }}><strong>Completed:</strong> {session.completedText}</p>}
                {session.blockerText && <p style={{ margin: 0 }}><strong>Blocked by:</strong> {session.blockerText}</p>}
              </div>
            </div>
          )}

          {session.focusPhases?.seconds && Object.values(session.focusPhases.seconds).some(seconds => seconds > 0) && (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                Phase shape
              </p>
              <div style={{ display: 'flex', height: 8, width: '100%', borderRadius: 999, overflow: 'hidden', background: 'rgba(122,152,255,0.06)' }}>
                {Object.entries(session.focusPhases.seconds)
                  .filter(([, seconds]) => seconds > 0)
                  .map(([phase, seconds]) => (
                    <div
                      key={phase}
                      title={`${PHASE_LABELS[phase] || phase}: ${fmt(seconds)}`}
                      style={{ flex: seconds, minWidth: 2, background: PHASE_COLORS[phase] || 'var(--text-muted)' }}
                    />
                  ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: 8 }}>
                {Object.entries(session.focusPhases.seconds)
                  .filter(([, seconds]) => seconds > 0)
                  .map(([phase, seconds]) => (
                    <span key={phase} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {PHASE_LABELS[phase] || phase}: {fmt(seconds)}
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* Full timeline */}
          {session.timeline?.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                Focus timeline
              </p>
              <div style={{
                width: '100%', height: 10, borderRadius: 5, overflow: 'hidden',
                display: 'flex', background: 'rgba(122,152,255,0.08)',
              }}>
                {session.timeline.map((pt, i) => {
                  const s = pt.score != null ? pt.score : (pt.focused ? 80 : 20)
                  const color = `hsl(${Math.round(s * 1.2)}, 80%, 50%)`
                  return (
                    <div key={i} style={{
                      flex: 1, minWidth: 2,
                      background: color,
                      borderBottom: pt.phase ? `3px solid ${PHASE_COLORS[pt.phase] || 'var(--text-muted)'}` : 'none',
                      opacity: pt.preDrift ? 0.6 : 1,
                    }} title={[
                      `${fmt(pt.second || 0)}: ${s}% focus`,
                      pt.phase ? `Phase: ${PHASE_LABELS[pt.phase] || pt.phase}` : null,
                      pt.preDrift ? 'Drift risk active' : null,
                      pt.activity?.kind ? `Activity: ${pt.activity.kind}` : null,
                    ].filter(Boolean).join(' | ')} />
                  )
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Start</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>End</span>
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
    const measuredSessions = sessions.filter(hasMeasuredFocus)
    // 1. Total focused seconds (not actual seconds)
    const totalFocusTime = measuredSessions.reduce((a, s) => a + (s.focusedSeconds ?? 0), 0)
    // 2. Rolling avg focus %
    const avgFocus = measuredSessions.length
      ? Math.round(measuredSessions.reduce((a, s) => a + sessionFocusPct(s), 0) / measuredSessions.length)
      : null
    // 3. Current day streak
    const currentStreak = computeCurrentStreak(sessions)
    // 4. Best single session focus %
    const bestSession = measuredSessions.reduce((best, s) => {
      const pct = sessionFocusPct(s) ?? 0
      return pct > (best.pct ?? -1) ? { ...s, pct } : best
    }, {})
    const bestPct = measuredSessions.length ? Math.round(bestSession.pct ?? 0) : null
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
        { label: 'Avg focus %',       value: stats.avgFocus == null ? '--' : `${stats.avgFocus}%`,   color: focusColor(stats.avgFocus) },
        { label: 'Current streak',    value: `${stats.currentStreak}d` },
        { label: 'Best session',      value: stats.bestPct == null ? '--' : `${stats.bestPct}%`,    color: focusColor(stats.bestPct) },
      ].map((s) => (
        <div key={s.label} style={{
          background: 'var(--surface)',
          border: 'none',
          borderRadius: 16,
          padding: '18px 16px',
          textAlign: 'center',
          boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
        }}>
          <p style={{
            fontSize: 28, fontWeight: 300, letterSpacing: '-0.025em',
            color: s.color ?? 'var(--text)', marginBottom: 6,
          }}>
            {s.value}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
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
    const measured = ds.filter(hasMeasuredFocus)
    if (measured.length > 0) {
      avgFocus = Math.round(
        measured.reduce((a, s) => a + sessionFocusPct(s), 0) / measured.length
      )
    }
    days.push({ label, avgFocus, count: ds.length })
  }
  return days
}

// What your own history says about how you work. Statistics over your sessions,
// not a model's opinion — and silent until there is enough to be honest about.
function PersonalCalibration({ sessions }) {
  const c = useMemo(() => calibrate(sessions), [sessions])

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--line)',
      borderRadius: 16,
      padding: '20px',
      marginBottom: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
          How you work
        </p>
        {c.ready && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            from {c.sessionsAnalysed} measured sessions
          </span>
        )}
      </div>

      {!c.ready ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          {c.needMore} more measured {c.needMore === 1 ? 'session' : 'sessions'} and this can tell you
          when you focus best, whether you over-plan, and which session length actually holds.
          Nothing is claimed before then — a pattern read from four sessions is a guess.
        </p>
      ) : c.insights.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          No pattern stands out yet. Your sessions look consistent across times and lengths,
          which is its own answer.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {c.insights.map(i => (
            <div key={i.kind} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--ultra-bright)', fontSize: 13, lineHeight: 1.5 }}>—</span>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                {i.text}
                <span style={{ color: 'var(--text-muted)' }}> ({i.n} sessions)</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WeeklyTrends({ sessions }) {
  const days = useMemo(() => getLast7Days(sessions), [sessions])
  const MAX_H = 48
  const GOAL_PCT = 70
  const goalLineBottom = Math.round((GOAL_PCT / 100) * MAX_H) // px from bottom of bar area

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 16,
      padding: '20px 20px 16px',
      boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
      marginBottom: 24,
    }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16, margin: '0 0 16px' }}>
        Last 7 days
      </p>
      <div style={{ position: 'relative' }}>
        {/* Goal line at 70% */}
        <div style={{
          position: 'absolute',
          left: 0, right: 0,
          bottom: 28 + goalLineBottom, // 28px = label height approx
          borderTop: '1.5px dashed #94a3b8',
          zIndex: 1,
          pointerEvents: 'none',
        }}>
          <span style={{ position: 'absolute', right: 0, top: -10, fontSize: 9, color: 'var(--text-secondary)', fontWeight: 600 }}>70%</span>
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            {days.map((day, i) => {
              const filled = day.avgFocus !== null
              const h = filled ? Math.max(4, Math.round((day.avgFocus / 100) * MAX_H)) : 4
              const color = filled ? focusColor(day.avgFocus) : 'var(--line)'
              const tooltip = filled
                ? `${day.label} — ${day.avgFocus}% avg, ${day.count} session${day.count !== 1 ? 's' : ''}`
                : `${day.label} — no sessions`
              return (
                <div key={i} title={tooltip} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: filled ? 'var(--text-muted)' : 'transparent' }}>
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
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>{day.label}</span>
                  <span style={{ fontSize: 9, color: filled ? 'var(--line-strong)' : 'transparent', fontWeight: 500 }}>
                    {filled ? day.count : '0'}
                  </span>
                </div>
              )
            })}
          </div>
          {/* Trend line SVG overlay */}
          {(() => {
            const filledDays = days.map((d, i) => ({ ...d, i })).filter(d => d.avgFocus !== null)
            if (filledDays.length < 2) return null
            // Each day takes 1/7 of width; bar midpoint at (i + 0.5) / 7
            // Bar top is at: 70 - h px from top of bar area (height=70)
            // Label area below adds ~24px; score label above adds ~16px
            // We place SVG over the bar area (height 70, positioned with top offset for score label ~16px)
            const W = 100; const H = 70
            const points = filledDays.map(d => {
              const x = ((d.i + 0.5) / 7) * W
              const barH = Math.max(4, Math.round((d.avgFocus / 100) * MAX_H))
              const y = H - barH // midpoint top of bar
              return `${x},${y}`
            }).join(' ')
            return (
              <svg
                style={{ position: 'absolute', top: 16, left: 0, width: '100%', height: 70, pointerEvents: 'none' }}
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
              >
                <polyline
                  points={points}
                  fill="none"
                  stroke="rgba(99,102,241,0.6)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="3,2"
                />
                {filledDays.map(d => {
                  const x = ((d.i + 0.5) / 7) * W
                  const barH = Math.max(4, Math.round((d.avgFocus / 100) * MAX_H))
                  const y = H - barH
                  return <circle key={d.i} cx={x} cy={y} r="2" fill="#6366f1" opacity="0.7" />
                })}
              </svg>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

function getThisWeekSessions(sessions) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - start.getDay())
  return sessions.filter(session => new Date(session.timestamp) >= start)
}

function WeeklySummary({ sessions }) {
  const stats = useMemo(() => {
    const weekSessions = getThisWeekSessions(sessions)
    const measured = weekSessions.filter(hasMeasuredFocus)
    const avgFocus = measured.length
      ? Math.round(measured.reduce((sum, session) => sum + sessionFocusPct(session), 0) / measured.length)
      : null
    const totalFocusedTime = measured.reduce((sum, session) => sum + (session.focusedSeconds || 0), 0)
    const outcomes = { yes: 0, partly: 0, no: 0, unset: 0 }
    for (const session of weekSessions) {
      outcomes[normalizedOutcome(session) || 'unset'] += 1
    }
    return {
      count: weekSessions.length,
      avgFocus,
      totalFocusedTime,
      outcomes,
    }
  }, [sessions])

  const outcomeItems = [
    { key: 'yes', label: 'Yes', color: 'var(--good)' },
    { key: 'partly', label: 'Partly', color: 'var(--warn)' },
    { key: 'no', label: 'No', color: 'var(--bad)' },
  ]
  const answered = outcomeItems.reduce((sum, item) => sum + stats.outcomes[item.key], 0)

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--line)',
      borderRadius: 16,
      padding: '18px 20px',
      marginBottom: 24,
      boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
          This week
        </p>
        {stats.outcomes.unset > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
            {stats.outcomes.unset} outcome{stats.outcomes.unset === 1 ? '' : 's'} unset
          </span>
        )}
      </div>
      <div className="history-stats-grid" style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Sessions', value: stats.count },
          { label: 'Avg focus', value: stats.avgFocus == null ? '--' : `${stats.avgFocus}%`, color: focusColor(stats.avgFocus) },
          { label: 'Focused time', value: fmt(stats.totalFocusedTime) },
        ].map(item => (
          <div key={item.label} style={{
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            padding: '13px 10px',
            textAlign: 'center',
          }}>
            <p style={{ fontSize: 22, fontWeight: 300, color: item.color || 'var(--text)', marginBottom: 4 }}>
              {item.value}
            </p>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
              {item.label}
            </p>
          </div>
        ))}
      </div>
      <div>
        <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: 'rgba(122,152,255,0.06)' }}>
          {outcomeItems.map(item => {
            const count = stats.outcomes[item.key]
            return count > 0 ? (
              <div
                key={item.key}
                title={`${item.label}: ${count}`}
                style={{ flex: count, minWidth: 4, background: item.color }}
              />
            ) : null
          })}
          {answered === 0 && <div style={{ flex: 1, background: 'var(--line)' }} />}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: 8 }}>
          {outcomeItems.map(item => (
            <span key={item.key} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <span style={{ color: item.color, fontWeight: 800 }}>{item.label}</span>: {stats.outcomes[item.key]}
            </span>
          ))}
        </div>
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
  const [selectedDay, setSelectedDay] = useState(null) // day of month (number) when in month view
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 10

  const filteredSessions = useMemo(() => {
    let result = sessions
    if (dateFilter !== 'all') {
      const now = new Date()
      const cutoff = new Date(now)
      if (dateFilter === 'week') cutoff.setDate(now.getDate() - 7)
      else if (dateFilter === 'month') {
        cutoff.setDate(1)
        cutoff.setHours(0, 0, 0, 0)
      }
      result = result.filter(s => new Date(s.timestamp) >= cutoff)
    }
    // Day filter when in month view
    if (dateFilter === 'month' && selectedDay !== null) {
      const now = new Date()
      result = result.filter(s => {
        const d = new Date(s.timestamp)
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === selectedDay
      })
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(s => (s.task || '').toLowerCase().includes(q))
    }
    return result
  }, [sessions, dateFilter, search])

  const pagedSessions = useMemo(() => filteredSessions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filteredSessions, page])
  const groupedSessions = useMemo(() => groupByDate(pagedSessions), [pagedSessions])
  const totalPages = Math.ceil(filteredSessions.length / PAGE_SIZE)

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
    const header = ['timestamp', 'task', 'goal', 'intendedOutput', 'successCriteria', 'energyLevel', 'goalOutcome', 'completedText', 'blockerText', 'durationSeconds', 'focusPct', 'distractionEvents', 'longestStreakSeconds']
    const rows = sessions.map(s => {
      const focusPct = sessionFocusPct(s)
      return [
        new Date(s.timestamp).toISOString(),
        `"${(s.task || '').replace(/"/g, '""')}"`,
        `"${(s.goal || '').replace(/"/g, '""')}"`,
        `"${(s.intendedOutput || '').replace(/"/g, '""')}"`,
        `"${(s.successCriteria || '').replace(/"/g, '""')}"`,
        s.energyLevel || '',
        s.goalOutcome || '',
        `"${(s.completedText || '').replace(/"/g, '""')}"`,
        `"${(s.blockerText || '').replace(/"/g, '""')}"`,
        s.actualSeconds ?? 0,
        focusPct ?? '',
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
      background: 'var(--bg)',
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
            <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.025em', color: 'var(--text)' }}>
              Session History
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 4 }}>
              {sessions.length} session{sessions.length !== 1 ? 's' : ''} · {fmt(sessions.filter(hasMeasuredFocus).reduce((a, s) => a + (s.focusedSeconds ?? 0), 0))} measured focused
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '9px 22px',
              fontSize: 14, fontWeight: 600,
              background: 'var(--ultra)', color: 'var(--text)',
              border: 'none', borderRadius: 12,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            ← Back
          </button>
        </div>

        {sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <p style={{ fontSize: 32, fontWeight: 300, color: 'var(--text)', margin: 0 }}>
              No sessions yet
            </p>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 8 }}>
              Complete your first focus session to see your stats here.
            </p>
            <button
              onClick={onClose}
              style={{
                marginTop: 24,
                border: '1.5px solid var(--line)',
                borderRadius: 100,
                padding: '10px 24px',
                fontSize: 14, color: 'var(--text-muted)',
                background: 'transparent',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Start your first session →
            </button>
          </div>
        ) : (
          <>
            <WeeklySummary sessions={sessions} />
            <WeeklyTrends sessions={sessions} />
          <PersonalCalibration sessions={sessions} />
            <OverallStats sessions={sessions} />

            {/* Date filter pills */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {[['all','All time'],['week','This week'],['month','This month']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => { setDateFilter(val); setPage(0); setSelectedDay(null) }}
                  style={{
                    border: dateFilter === val ? '1.5px solid var(--ultra)' : '1.5px solid var(--line)',
                    borderRadius: 100, padding: '6px 16px',
                    fontSize: 12, fontWeight: 600,
                    background: dateFilter === val ? 'var(--ultra)' : 'transparent',
                    color: dateFilter === val ? '#fff' : '#6B7280',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >{label}</button>
              ))}
            </div>

            {/* Month calendar grid */}
            {dateFilter === 'month' && (
              <MonthCalendar
                sessions={sessions}
                selectedDay={selectedDay}
                onDayClick={(day) => { setSelectedDay(day); setPage(0) }}
              />
            )}

            {/* Search filter */}
            <div style={{ position: 'relative', marginBottom: 20 }}>
              <input
                type="text"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0) }}
                placeholder="Search sessions..."
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '8px 32px 8px 12px',
                  background: 'rgba(122,152,255,0.05)', border: '1.5px solid var(--line)',
                  borderRadius: 10, fontSize: 13, color: 'var(--ultra-bright)',
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
                    color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer',
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
                    fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    margin: '0 0 8px',
                  }}>
                    {group.label}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {group.sessions.map(s => {
                        const idx = filteredSessions.findIndex(fs => fs.id === s.id)
                        const prevSession = idx < filteredSessions.length - 1 ? filteredSessions[idx + 1] : null
                        return (
                          <SessionCard
                            key={s.id}
                            session={s}
                            prevSession={prevSession}
                            onDelete={handleDelete}
                            onExpand={handleExpand}
                            expanded={expandedId === s.id}
                            onNoteUpdate={handleNoteUpdate}
                          />
                        )
                      })}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 24 }}>
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  style={{
                    padding: '7px 16px', fontSize: 13, fontWeight: 600,
                    border: '1.5px solid var(--line)', borderRadius: 100,
                    background: 'transparent', color: page === 0 ? 'var(--line-strong)' : 'var(--ultra)',
                    cursor: page === 0 ? 'default' : 'pointer', fontFamily: 'inherit',
                  }}
                >← Previous</button>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredSessions.length)} of {filteredSessions.length} sessions
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  style={{
                    padding: '7px 16px', fontSize: 13, fontWeight: 600,
                    border: '1.5px solid var(--line)', borderRadius: 100,
                    background: 'transparent', color: page >= totalPages - 1 ? 'var(--line-strong)' : 'var(--ultra)',
                    cursor: page >= totalPages - 1 ? 'default' : 'pointer', fontFamily: 'inherit',
                  }}
                >Next →</button>
              </div>
            )}

            <div style={{ marginTop: 40, textAlign: 'center' }}>
              {!confirmClear ? (
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button
                    onClick={handleExportCSV}
                    style={{
                      background: 'none', border: '1px solid var(--line)',
                      color: 'var(--text-muted)', fontSize: 13, padding: '8px 20px',
                      borderRadius: 100, cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'color 0.15s, border-color 0.15s',
                    }}
                  >
                    Export CSV
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="no-print"
                    style={{
                      background: 'none', border: '1px solid var(--line)',
                      color: 'var(--text-muted)', fontSize: 13, padding: '8px 20px',
                      borderRadius: 100, cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'color 0.15s, border-color 0.15s',
                    }}
                  >
                    Print / Save PDF
                  </button>
                  <button
                    onClick={() => setConfirmClear(true)}
                    style={{
                      background: 'none', border: '1px solid var(--line)',
                      color: 'var(--text-muted)', fontSize: 13, padding: '8px 20px',
                      borderRadius: 100, cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'color 0.15s, border-color 0.15s',
                    }}
                  >
                    Clear all history
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Are you sure?</span>
                  <button
                    onClick={handleClearAll}
                    style={{
                      background: 'var(--bad)', color: 'var(--text)', border: 'none',
                      fontSize: 13, padding: '8px 18px', borderRadius: 100,
                      cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                    }}
                  >
                    Yes, delete all
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    style={{
                      background: 'none', border: '1px solid var(--line)',
                      color: 'var(--text-muted)', fontSize: 13, padding: '8px 18px',
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
