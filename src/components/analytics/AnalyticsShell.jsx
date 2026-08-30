import { useCallback, useEffect, useState } from 'react'
import { sessionRepository } from '../../lib/sessionRepository'
import { emptyFocusLedger } from '../../lib/focusMetric'
import Overview from './Overview'
import Patterns from './Patterns'
import Sessions from './Sessions'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'sessions', label: 'Sessions' },
]

/**
 * The persistent top-level Analytics area: Overview / Patterns / Sessions,
 * on a wider desktop canvas than the rest of the app. Owns the one shared
 * load of sessions + the focus ledger so the three views never each fetch
 * their own copy, and owns the mutations (delete/clear/outcome edit) so a
 * change in Sessions is immediately visible in Overview/Patterns too.
 */
export default function AnalyticsShell({ onClose }) {
  const [view, setView] = useState('overview')
  const [sessions, setSessions] = useState([])
  const [focusLedger, setFocusLedger] = useState(() => emptyFocusLedger())
  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [loading, setLoading] = useState(true)

  // Overview and Patterns both run over the full history (calibration needs
  // every qualifying session), so the shell loads once and shares the result
  // rather than having each view fetch its own copy.
  const refresh = useCallback(async () => {
    const [loadedSessions, loadedLedger] = await Promise.all([
      sessionRepository.loadAll(),
      sessionRepository.loadFocusLedger(),
    ])
    setSessions(loadedSessions)
    setFocusLedger(loadedLedger)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    refresh()
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refresh])

  const handleDeleteSession = async (id) => {
    await sessionRepository.deleteSession(id)
    if (selectedSessionId === id) setSelectedSessionId(null)
    await refresh()
  }

  const handleClearAll = async () => {
    await sessionRepository.clearAll()
    setSelectedSessionId(null)
    await refresh()
  }

  const handleUpdateSession = async (id, patch) => {
    await sessionRepository.updateSession(id, patch)
    await refresh()
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 64px)', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 32px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', margin: 0 }}>
            Analytics
          </h1>
          <button
            onClick={onClose}
            style={{ padding: '9px 22px', fontSize: 14, fontWeight: 600, background: 'var(--ultra)', color: 'var(--text)', border: 'none', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            ← Back
          </button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 28, borderBottom: '1px solid var(--line)' }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => { setView(tab.id); setSelectedSessionId(null) }}
              aria-current={view === tab.id ? 'page' : undefined}
              style={{
                padding: '10px 18px', fontSize: 14, fontWeight: 600,
                background: 'transparent',
                color: view === tab.id ? 'var(--ultra-bright)' : 'var(--text-muted)',
                border: 'none',
                borderBottom: view === tab.id ? '2px solid var(--ultra-bright)' : '2px solid transparent',
                cursor: 'pointer', fontFamily: 'inherit', marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p style={{ fontSize: 14, color: 'var(--text-muted)', padding: '40px 0' }}>Loading…</p>
        ) : sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <p style={{ fontSize: 28, fontWeight: 300, color: 'var(--text)', margin: 0 }}>No sessions yet</p>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 8 }}>Complete your first focus session to see your analytics here.</p>
          </div>
        ) : (
          <>
            {view === 'overview' && <Overview sessions={sessions} focusLedger={focusLedger} />}
            {view === 'patterns' && <Patterns sessions={sessions} />}
            {view === 'sessions' && (
              <Sessions
                sessions={sessions}
                focusLedger={focusLedger}
                selectedSessionId={selectedSessionId}
                onSelectSession={setSelectedSessionId}
                onDeleteSession={handleDeleteSession}
                onClearAll={handleClearAll}
                onUpdateSession={handleUpdateSession}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
