// localStorage-backed repository adapter.
//
// A thin async wrapper over storage.js, which keeps its existing behaviour
// unchanged — including the MAX_SESSIONS = 100 cap. That cap is the reason a
// native adapter exists at all; this adapter stays as the browser/dev/test
// backend where a bounded, synchronous store is fine.
//
// Every method is async even though nothing here awaits: the interface has to
// be identical to the native adapter's, or swapping them would change caller
// code, which is the entire point of having the abstraction.

import {
  loadSessions,
  loadFocusLedger,
  saveSession as saveSessionSync,
  updateSession as updateSessionSync,
  deleteSession as deleteSessionSync,
  clearAllSessions,
  backfillFocusLedgerFromSessions,
} from './storage'
import { filterSessions, paginate } from './sessionQuery'

export const ARCHIVE_SCHEMA_VERSION = 1

export function createLocalSessionRepository() {
  return {
    kind: 'local',

    async loadAll() {
      return loadSessions()
    },

    async listSessionSummaries(query = {}) {
      const filtered = filterSessions(loadSessions(), query)
      return paginate(filtered, query)
    },

    async getSession(id) {
      return loadSessions().find(session => session.id === id) || null
    },

    async saveSession(sessionData) {
      return saveSessionSync(sessionData)
    },

    async updateSession(id, patch) {
      updateSessionSync(id, patch)
      return loadSessions().find(session => session.id === id) || null
    },

    async deleteSession(id) {
      deleteSessionSync(id)
    },

    async clearAll() {
      clearAllSessions()
    },

    async loadFocusLedger() {
      return loadFocusLedger()
    },

    async backfillFocusLedger() {
      return backfillFocusLedgerFromSessions()
    },

    async exportArchive() {
      return {
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        sessions: loadSessions(),
        focusLedger: loadFocusLedger(),
      }
    },

    // Nothing to migrate: this adapter IS the legacy store. Reported as a
    // no-op rather than throwing so the app's startup path is adapter-agnostic.
    async migrateLegacyIfNeeded() {
      return { migrated: false, importedCount: 0, reason: 'local_adapter_is_source' }
    },
  }
}
