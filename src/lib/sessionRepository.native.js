// SQLite-backed repository adapter, reached through Tauri commands.
//
// Mirrors the localStorage adapter's interface exactly — see
// sessionRepository.js for the contract both must satisfy. The differences
// that matter:
//
//   * history is unbounded; there is no 100-session cap
//   * `listSessionSummaries` filters and paginates in SQL, so a list view
//     never loads records it will not draw, and omits per-session timelines
//   * a session and its focus-ledger contribution are written in one
//     transaction, so a score can never outlive the session behind it
//
// Scoring and filter semantics stay in JavaScript: this module computes the
// summary columns (sessionSummary.js) and the ledger day (focusMetric.js) and
// hands them over as data.

import {
  loadSessions as loadLegacySessions,
  loadFocusLedger as loadLegacyFocusLedger,
} from './storage'
import { addSessionToFocusLedger, localDayKey, withSessionFocusMetric } from './focusMetric'
import { buildSessionSummary } from './sessionSummary'
import { analyzeSession } from './sessionAnalysis'
import { DEFAULT_PAGE_SIZE, dateRangeCutoff } from './sessionQuery'
import { createLocalSessionRepository } from './sessionRepository.local'

export const ARCHIVE_SCHEMA_VERSION = 1

function invoke(command, args) {
  return globalThis.window.__TAURI__.core.invoke(command, args)
}

function toNativeQuery(query = {}) {
  return {
    // The same cutoff the in-memory filter uses, resolved to an absolute bound
    // for SQL. Shared rather than reimplemented so "this month" cannot come to
    // mean two different things depending on which adapter answered.
    dateFrom: dateRangeCutoff(query.dateRange, query.now ?? Date.now()),
    dateTo: null,
    outcome: query.outcome && query.outcome !== 'all' ? query.outcome : null,
    workspaceId: query.workspaceId && query.workspaceId !== 'all' ? query.workspaceId : null,
    measurement: query.measurement && query.measurement !== 'all' ? query.measurement : null,
    search: query.search || null,
    page: Number.isFinite(query.page) ? query.page : 0,
    pageSize: Number.isFinite(query.pageSize) ? query.pageSize : DEFAULT_PAGE_SIZE,
  }
}

/** The ledger day this session belongs to, after its contribution is folded
 *  in. Built with the same focusMetric.js code the web build uses, so the
 *  stored score is identical either way. */
function ledgerDayFor(session, currentLedger) {
  const dayKey = localDayKey(session.startedAt ?? session.timestamp)
  if (!dayKey) return { key: null, entry: null }
  const next = addSessionToFocusLedger(currentLedger, session)
  return { key: dayKey, entry: next.days?.[dayKey] ?? { sessions: {} } }
}

export function createNativeSessionRepository({ legacy = createLocalSessionRepository() } = {}) {
  // Until the legacy import has verifiably succeeded, the SQLite store is not
  // the source of truth — localStorage still is. Reading from an empty
  // database in that window would show someone an app with none of their
  // history in it, which is indistinguishable from having lost it.
  //
  // This is not hypothetical: it is what shipped. The app auto-updates from a
  // push to main, so it switched to reading SQLite before any import had run,
  // and every past session vanished from view while sitting untouched in
  // localStorage the whole time.
  let migrated = false

  /** True while the old store still holds the only copy of anything. */
  async function servedByLegacy() {
    if (migrated) return false
    return loadLegacySessions().length > 0
  }

  const repository = {
    kind: 'native',

    /** Whether reads are currently coming from SQLite or the legacy store. */
    get migrated() {
      return migrated
    },

    async loadAll() {
      if (await servedByLegacy()) return legacy.loadAll()
      return invoke('db_load_all')
    },

    async listSessionSummaries(query = {}) {
      if (await servedByLegacy()) return legacy.listSessionSummaries(query)
      const page = await invoke('db_list_session_summaries', { query: toNativeQuery(query) })
      return {
        rows: page.rows,
        total: page.total,
        page: page.page,
        pageSize: page.pageSize,
        pageCount: page.pageCount,
      }
    },

    async getSession(id) {
      if (await servedByLegacy()) return legacy.getSession(id)
      return (await invoke('db_get_session', { id })) ?? null
    },

    async saveSession(sessionData) {
      // id/timestamp are assigned here rather than in SQL so a record looks
      // the same whichever adapter wrote it.
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        ...sessionData,
      }
      const ledger = await repository.loadFocusLedger()
      const { key, entry: dayEntry } = ledgerDayFor(entry, ledger)
      await invoke('db_save_session', {
        session: entry,
        summary: buildSessionSummary(entry),
        analysis: analyzeSession(entry),
        ledgerDayKey: key,
        ledgerDayEntry: dayEntry,
      })
      return entry
    },

    async updateSession(id, patch) {
      const existing = await repository.getSession(id)
      if (!existing) return null
      const merged = { ...existing, ...patch }
      // An outcome edit changes the analysis, so the stored snapshot is
      // regenerated through the same versioned function the screens use.
      return invoke('db_update_session', {
        id,
        patch,
        summary: buildSessionSummary(merged),
        analysis: analyzeSession(merged),
      })
    },

    async deleteSession(id) {
      await invoke('db_delete_session', { id })
    },

    async clearAll() {
      await invoke('db_clear_all')
    },

    async loadFocusLedger() {
      if (await servedByLegacy()) return legacy.loadFocusLedger()
      return invoke('db_load_focus_ledger')
    },

    // The native store is written through withSessionFocusMetric on save, so
    // there is no pre-ledger history here to catch up. Legacy records are
    // upgraded by the migration below instead.
    async backfillFocusLedger() {
      return repository.loadFocusLedger()
    },

    async exportArchive() {
      const archive = await invoke('db_export_archive')
      return { ...archive, exportedAt: new Date().toISOString() }
    },

    /**
     * Import the localStorage archive on first native launch.
     *
     * The old copy is deliberately never deleted: if anything about this goes
     * wrong, the user's history must still be sitting where it was. Rust
     * verifies every id landed before recording success, so an interrupted
     * run simply retries next launch.
     */
    async migrateLegacyIfNeeded() {
      const legacySessions = loadLegacySessions()
      const legacyLedger = loadLegacyFocusLedger()
      if (legacySessions.length === 0) {
        // Nothing to carry over, so SQLite is authoritative from the start.
        migrated = true
        return { migrated: false, importedCount: 0, reason: 'nothing_to_migrate' }
      }
      // Upgrade recoverable legacy measurements the same way the web build
      // does on startup, so migrated sessions carry the metric they qualify
      // for rather than being frozen as unmeasured.
      const upgraded = legacySessions.map(withSessionFocusMetric)
      const result = await invoke('db_migrate_legacy', {
        sessions: upgraded,
        summaries: upgraded.map(buildSessionSummary),
        ledger: legacyLedger,
      })
      // Only hand over to SQLite once Rust confirms every id landed. Anything
      // else — a rollback, a partial import, a thrown error — leaves reads on
      // the legacy store, where the data demonstrably still is.
      if (result?.verified) migrated = true
      return result
    },
  }

  return repository
}
