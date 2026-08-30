import { useMemo, useState } from 'react'
import { sessionFocusPct, hasMeasuredFocus } from '../../lib/historyTrend'
import { fmtDuration } from '../../lib/sessionAnalysisPresentation'
import SessionDetailView from './sessions/SessionDetailView'

const PAGE_SIZE = 10
const DATE_FILTERS = [['all', 'All time'], ['week', 'This week'], ['month', 'This month']]
const OUTCOME_FILTERS = [['all', 'All'], ['yes', 'Yes'], ['partly', 'Partly'], ['no', 'No'], ['unrated', 'Unrated']]
const MEASURED_FILTERS = [['all', 'All'], ['measured', 'Measured'], ['unmeasured', 'Unmeasured']]

function normalizedOutcome(session) {
  if (session.goalOutcome) return session.goalOutcome
  if (session.goalAchieved === true) return 'yes'
  if (session.goalAchieved === false) return 'no'
  return null
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}
function focusColor(pct) {
  if (pct == null) return 'var(--text-muted)'
  if (pct >= 70) return 'var(--good)'
  if (pct >= 40) return 'var(--warn)'
  return 'var(--bad)'
}

// CSV respects the caller's current filters — the old History dashboard
// exported everything regardless of what was on screen, which read as a bug
// once Sessions became a filterable view.
function exportCSV(sessions) {
  const header = ['timestamp', 'task', 'workspace', 'workspaceRevision', 'goal', 'energyLevel', 'goalOutcome', 'completedText', 'blockerText', 'durationSeconds', 'measuredSeconds', 'timeAboveThresholdPct', 'distractionEvents', 'longestStreakSeconds']
  const rows = sessions.map(s => {
    const pct = sessionFocusPct(s)
    return [
      new Date(s.timestamp).toISOString(),
      `"${(s.task || '').replace(/"/g, '""')}"`,
      `"${(s.workspace?.name || '').replace(/"/g, '""')}"`,
      s.workspace?.revision ?? '',
      `"${(s.goal || '').replace(/"/g, '""')}"`,
      s.energyLevel || '',
      s.goalOutcome || '',
      `"${(s.completedText || '').replace(/"/g, '""')}"`,
      `"${(s.blockerText || '').replace(/"/g, '""')}"`,
      s.actualSeconds ?? 0,
      s.measuredSeconds ?? '',
      pct ?? '',
      s.distractionEvents ?? 0,
      s.longestFocusedStreak ?? 0,
    ].join(',')
  })
  const csv = [header.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `eudaimonia-sessions-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// Unlike the CSV, the full backup is always the complete, lossless history —
// full records, timelines, and the ledger — regardless of the active filters.
function exportFullArchive(sessions, focusLedger) {
  const archive = { schemaVersion: 1, exportedAt: new Date().toISOString(), sessions, focusLedger }
  const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `eudaimonia-full-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function FilterPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: active ? '1.5px solid var(--ultra)' : '1.5px solid var(--line)',
        borderRadius: 100, padding: '6px 14px', fontSize: 12, fontWeight: 600,
        background: active ? 'var(--ultra)' : 'transparent',
        color: active ? '#fff' : 'var(--text-muted)',
        cursor: 'pointer', fontFamily: 'inherit',
      }}
    >{children}</button>
  )
}

function SessionRow({ session, onSelect, onDelete }) {
  const pct = sessionFocusPct(session)
  const color = focusColor(pct)
  const outcome = normalizedOutcome(session)
  const outcomeLabel = outcome === 'yes' ? 'Goal reached' : outcome === 'partly' ? 'Partly reached' : outcome === 'no' ? 'Goal missed' : null

  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
        background: 'var(--surface)', border: '1px solid var(--line)', borderLeft: `4px solid ${color}`,
        borderRadius: 12, padding: '14px 18px', cursor: 'pointer',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.task || 'Untitled session'}
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          {fmtDate(session.timestamp)} · {fmtTime(session.timestamp)}
          {session.workspace?.name ? ` · ${session.workspace.name}` : ''}
          {' · '}{fmtDuration(session.actualSeconds)}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {outcomeLabel && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{outcomeLabel}</span>}
        <span style={{ background: color + '18', border: `1px solid ${color}40`, borderRadius: 100, padding: '4px 10px', fontSize: 12, fontWeight: 700, color }}>
          {pct == null ? 'Not measured' : `${pct}%`}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Delete"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--line-strong)', fontSize: 16, lineHeight: 1, padding: '2px 4px' }}
        >×</button>
      </div>
    </div>
  )
}

function pageBtnStyle(disabled) {
  return {
    padding: '7px 16px', fontSize: 13, fontWeight: 600,
    border: '1.5px solid var(--line)', borderRadius: 100,
    background: 'transparent', color: disabled ? 'var(--line-strong)' : 'var(--ultra)',
    cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
  }
}

const ghostBtnStyle = {
  background: 'none', border: '1px solid var(--line)', color: 'var(--text-muted)',
  fontSize: 13, padding: '8px 20px', borderRadius: 100, cursor: 'pointer', fontFamily: 'inherit',
}

/**
 * Searchable, paginated session history. Selecting a row opens the shared
 * SessionReport in place (SessionDetailView) — a dedicated route isn't needed
 * since "back" is just clearing the selection.
 */
export default function Sessions({ sessions, focusLedger, selectedSessionId, onSelectSession, onDeleteSession, onClearAll, onUpdateSession }) {
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('all')
  const [outcomeFilter, setOutcomeFilter] = useState('all')
  const [workspaceFilter, setWorkspaceFilter] = useState('all')
  const [measuredFilter, setMeasuredFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [confirmClear, setConfirmClear] = useState(false)

  const workspaceOptions = useMemo(() => {
    const seen = new Map()
    for (const s of sessions) {
      if (s.workspace?.id && !seen.has(s.workspace.id)) seen.set(s.workspace.id, s.workspace.name || s.workspace.id)
    }
    return [...seen.entries()]
  }, [sessions])

  const filtered = useMemo(() => {
    let result = sessions
    if (dateFilter !== 'all') {
      const now = new Date()
      const cutoff = new Date(now)
      if (dateFilter === 'week') cutoff.setDate(now.getDate() - 7)
      else { cutoff.setDate(1); cutoff.setHours(0, 0, 0, 0) }
      result = result.filter(s => new Date(s.timestamp) >= cutoff)
    }
    if (outcomeFilter !== 'all') {
      result = result.filter(s => (normalizedOutcome(s) || 'unrated') === outcomeFilter)
    }
    if (workspaceFilter !== 'all') {
      result = result.filter(s => s.workspace?.id === workspaceFilter)
    }
    if (measuredFilter !== 'all') {
      const wantMeasured = measuredFilter === 'measured'
      result = result.filter(s => hasMeasuredFocus(s) === wantMeasured)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(s =>
        (s.task || '').toLowerCase().includes(q) ||
        (s.tags || []).some(tag => tag.toLowerCase().includes(q)))
    }
    return result
  }, [sessions, dateFilter, outcomeFilter, workspaceFilter, measuredFilter, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page])

  const selectedSession = selectedSessionId ? sessions.find(s => s.id === selectedSessionId) : null
  if (selectedSession) {
    return (
      <SessionDetailView
        session={selectedSession}
        allSessions={sessions}
        onBack={() => onSelectSession(null)}
        onUpdateSession={onUpdateSession}
      />
    )
  }

  if (sessions.length === 0) {
    return <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>No sessions yet.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {DATE_FILTERS.map(([val, label]) => (
          <FilterPill key={val} active={dateFilter === val} onClick={() => { setDateFilter(val); setPage(0) }}>{label}</FilterPill>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {OUTCOME_FILTERS.map(([val, label]) => (
          <FilterPill key={val} active={outcomeFilter === val} onClick={() => { setOutcomeFilter(val); setPage(0) }}>{label}</FilterPill>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {MEASURED_FILTERS.map(([val, label]) => (
          <FilterPill key={val} active={measuredFilter === val} onClick={() => { setMeasuredFilter(val); setPage(0) }}>{label}</FilterPill>
        ))}
        {workspaceOptions.length > 0 && (
          <select
            value={workspaceFilter}
            onChange={e => { setWorkspaceFilter(e.target.value); setPage(0) }}
            style={{ padding: '6px 10px', fontSize: 12, borderRadius: 100, border: '1.5px solid var(--line)', background: 'transparent', color: 'var(--text-muted)', fontFamily: 'inherit' }}
          >
            <option value="all">All workspaces</option>
            {workspaceOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
      </div>
      <input
        type="text"
        className="text-input"
        value={search}
        onChange={e => { setSearch(e.target.value); setPage(0) }}
        placeholder="Search task or tags…"
        style={{ maxWidth: 320 }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {paged.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No sessions match these filters.</p>
        ) : paged.map(s => (
          <SessionRow key={s.id} session={s} onSelect={() => onSelectSession(s.id)} onDelete={() => onDeleteSession(s.id)} />
        ))}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 8 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={pageBtnStyle(page === 0)}>← Previous</button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {filtered.length ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length}` : '0 of 0'}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={pageBtnStyle(page >= totalPages - 1)}>Next →</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        {!confirmClear ? (
          <>
            <button onClick={() => exportCSV(filtered)} style={ghostBtnStyle}>Export CSV</button>
            <button onClick={() => exportFullArchive(sessions, focusLedger)} style={ghostBtnStyle}>Export full backup (JSON)</button>
            <button onClick={() => setConfirmClear(true)} style={ghostBtnStyle}>Clear all history</button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', alignSelf: 'center' }}>Are you sure?</span>
            <button onClick={() => { onClearAll(); setConfirmClear(false) }} style={{ ...ghostBtnStyle, background: 'var(--bad)', color: '#fff', border: 'none', fontWeight: 600 }}>Yes, delete all</button>
            <button onClick={() => setConfirmClear(false)} style={ghostBtnStyle}>Cancel</button>
          </>
        )}
      </div>
    </div>
  )
}
