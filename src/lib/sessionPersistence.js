// Persisting a finished session, and the answers given about it.
//
// This is a small state machine with one job that is easy to get wrong: the
// post-session screen appears before the save resolves, so the user can answer
// the check-in while there is still no stored row to patch. Answers given in
// that window have to wait and then be written, not dropped.
//
// It lived inline in App/EndScreen once, and the component holding it kept its
// own copy of the session record — which never saw the storage id arrive, so
// the `if (session.id)` guard around the write was false forever and every
// check-in answered right after a session was silently lost. Pulling it out
// here makes that sequence something a test can drive directly instead of
// something you have to reason about across two components.

/**
 * @param repository  a session repository (see sessionRepository.js)
 */
export function createSessionPersister(repository) {
  let savedId = null
  let pending = {}

  return {
    /** Whether the session has a stored row yet. */
    get savedId() {
      return savedId
    },
    /** Edits accepted but not yet written. Exposed for assertions. */
    get pendingEdits() {
      return { ...pending }
    },

    /** Begin a new session; nothing carries over from the previous one. */
    reset() {
      savedId = null
      pending = {}
    },

    /**
     * Persist a completed session. Any answers given while the write was in
     * flight are applied straight after, and returned merged into the record
     * so the caller can render them without a second round trip.
     *
     * Throws on failure, leaving pending edits queued — the caller decides
     * whether to surface a retry.
     */
    async save(record) {
      const saved = await repository.saveSession(record)
      savedId = saved.id
      const queued = pending
      pending = {}
      if (Object.keys(queued).length > 0) {
        await repository.updateSession(saved.id, queued)
      }
      return { ...saved, ...queued }
    },

    /**
     * Record a check-in answer. Written immediately once there is a row,
     * queued until then. A failed write goes back on the queue rather than
     * being lost, so the next successful write carries it.
     */
    async edit(patch) {
      if (!savedId) {
        pending = { ...pending, ...patch }
        return
      }
      try {
        await repository.updateSession(savedId, patch)
      } catch {
        pending = { ...pending, ...patch }
      }
    },
  }
}
