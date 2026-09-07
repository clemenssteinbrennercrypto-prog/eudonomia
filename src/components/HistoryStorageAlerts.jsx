/**
 * Storage handover and deletion cleanup are opposite states and must never be
 * announced together. A deletion tombstone makes SQLite authoritative even
 * when an older browser-storage copy still needs cleanup, so that state always
 * outranks an earlier migration failure.
 */
export default function HistoryStorageAlerts({ migrationError, deletionCleanupError, screen }) {
  if (screen === 'session') return null

  if (deletionCleanupError) {
    return (
      <div className="session-save-error" role="alert">
        <span>
          Your history was deleted from the local database, but the older
          browser-storage copy could not be removed ({deletionCleanupError}).
          Nothing is read from that copy any more and it can never be imported
          back, but it is still on this device. The app will try to remove it
          again next launch.
        </span>
      </div>
    )
  }

  if (!migrationError) return null
  return (
    <div className="session-save-error" role="alert">
      <span>
        Your history could not be imported into the new local database
        ({migrationError}). Nothing has been deleted — your sessions are still
        being read from their original storage, and the app will try the import
        again next launch.
      </span>
    </div>
  )
}
