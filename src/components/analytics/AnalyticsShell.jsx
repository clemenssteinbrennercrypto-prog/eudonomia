import { useCallback, useEffect, useState } from 'react'
import { sessionRepository } from '../../lib/sessionRepository'
import { emptyFocusLedger, removeSessionFromFocusLedger } from '../../lib/focusMetric'
import Overview from './Overview'
import Patterns from './Patterns'
import Sessions from './Sessions'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'sessions', label: 'Sessions' },
]

/**
 * Word a failed "delete all history" for the user.
 *
 * Two unrelated failures reach the same catch and mean opposite things: the
 * native delete was rejected and removed nothing, or it succeeded and only the
 * old browser-storage copy survived. Labelling both "only partially completed"
 * told someone whose delete never ran that part of their history was gone.
 */
export function historyDeletionMessage(error) {
  const detail = String(error?.message || error)
  return error?.partialDeletion === true
    ? `History deletion was only partially completed: ${detail}`
    : `History could not be deleted: ${detail}`
}

/**
 * Keep the deletion result separate from the refresh that follows it.
 *
 * A refresh is presentation work: it can fail after the database transaction
 * has already committed. Returning both outcomes prevents the UI from turning
 * that later read error into the opposite claim that deletion failed.
 */
export async function clearHistoryAndRefresh({ clearAll, refresh, onHistoryCleared = () => {} }) {
  let deleted = false
  let deletionError = null
  let cleanupWarning = null

  try {
    await clearAll()
    deleted = true
  } catch (error) {
    deletionError = historyDeletionMessage(error)
    if (error?.partialDeletion === true) {
      deleted = true
      cleanupWarning = error.deletionCleanupError || String(error?.message || error)
    }
  }

  if (deleted) onHistoryCleared(cleanupWarning)

  try {
    await refresh()
    return { deleted, deletionError, refreshError: null }
  } catch (error) {
    return {
      deleted,
      deletionError,
      refreshError: String(error?.message || error),
    }
  }
}

/**
 * The persistent top-level Analytics area: Overview / Patterns / Sessions,
 * on a wider desktop canvas than the rest of the app. Owns the one shared
 * load of sessions + the focus ledger so the three views never each fetch
 * their own copy, and owns the mutations (delete/clear/outcome edit) so a
 * change in Sessions is immediately visible in Overview/Patterns too.
 */
export default function AnalyticsShell({ onClose, onHistoryCleared = () => {} }) {
  const [view, setView] = useState('overview')
  const [sessions, setSessions] = useState([])
  const [focusLedger, setFocusLedger] = useState(() => emptyFocusLedger())
  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [mutationError, setMutationError] = useState(null)

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
      .then(() => { if (!cancelled) setLoadError(null) })
      .catch(error => {
        if (!cancelled) setLoadError({ detail: String(error?.message || error), afterDeletion: false })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refresh])

  const retryLoad = async () => {
    setLoading(true)
    try {
      await refresh()
      setLoadError(null)
    } catch (error) {
      setLoadError(current => ({
        detail: String(error?.message || error),
        afterDeletion: current?.afterDeletion === true,
      }))
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteSession = async (id) => {
    await sessionRepository.deleteSession(id)
    setMutationError(null)
    if (selectedSessionId === id) setSelectedSessionId(null)
    setSessions(current => current.filter(session => session.id !== id))
    setFocusLedger(current => removeSessionFromFocusLedger(current, id))
  }

  const handleClearAll = async () => {
    const result = await clearHistoryAndRefresh({
      clearAll: () => sessionRepository.clearAll(),
      refresh,
      onHistoryCleared,
    })
    setMutationError(result.deletionError)
    if (result.deleted) {
      setSelectedSessionId(null)
    }
    setLoadError(result.refreshError
      ? { detail: result.refreshError, afterDeletion: result.deleted }
      : null)
  }

  const handleUpdateSession = async (id, patch) => {
    await sessionRepository.updateSession(id, patch)
    setMutationError(null)
    await refresh()
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 64px)', background: 'var(--bg)' }}>
      {mutationError && <div role="alert" className="session-save-error">{mutationError}</div>}
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
              onClick={() => { setView(tab.id); setSelectedSessionId(null); setMutationError(null) }}
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

        {loadError ? (
          <div role="alert" style={{ padding: '40px 0', color: 'var(--text)' }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Session history could not be loaded.</p>
            <p style={{ margin: '8px 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>
              {loadError.afterDeletion
                ? 'History was deleted, but the updated view could not be loaded.'
                : 'No data has been deleted.'}
              {' '}The local database reported: {loadError.detail}
            </p>
            <button
              type="button"
              onClick={retryLoad}
              disabled={loading}
              style={{ padding: '9px 18px', fontSize: 13, fontWeight: 700, background: 'var(--ultra)', color: 'var(--text)', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {loading ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        ) : loading ? (
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
