import { useCallback, useEffect, useState } from 'react'
import { sessionRepository } from '../../lib/sessionRepository'
import { emptyFocusLedger, removeSessionFromFocusLedger } from '../../lib/focusMetric'
import AnalyticsStory from './AnalyticsStory'
import DataExplorer from './DataExplorer'

const VIEWS = [
  { id: 'story', label: 'Overview' },
  { id: 'data', label: 'Details' },
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
 * The persistent top-level Analytics area: Overview for recent results and
 * session history, Details for the underlying distributions. Owns the one
 * shared load of sessions + the focus ledger and every history mutation.
 */
export default function AnalyticsShell({ onClose, onHistoryCleared = () => {} }) {
  const [view, setView] = useState('story')
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
    <div className="analytics-shell">
      {mutationError && <div role="alert" className="session-save-error">{mutationError}</div>}
      <div className="analytics-canvas">
        <div className="analytics-heading">
          <div>
            <span>Recent work first · detailed evidence when you need it</span>
            <h1>Analytics</h1>
          </div>
          <button onClick={onClose}>← Back</button>
        </div>

        <div className="analytics-view-switch" aria-label="Analytics view">
          {VIEWS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => { setView(tab.id); setSelectedSessionId(null); setMutationError(null) }}
              aria-current={view === tab.id ? 'page' : undefined}
              className={view === tab.id ? 'is-active' : ''}
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
        ) : (
          <>
            {view === 'story' && (
              <AnalyticsStory
                sessions={sessions}
                focusLedger={focusLedger}
                selectedSessionId={selectedSessionId}
                onSelectSession={setSelectedSessionId}
                onDeleteSession={handleDeleteSession}
                onClearAll={handleClearAll}
                onUpdateSession={handleUpdateSession}
              />
            )}
            {view === 'data' && <DataExplorer sessions={sessions} />}
          </>
        )}
      </div>
    </div>
  )
}
