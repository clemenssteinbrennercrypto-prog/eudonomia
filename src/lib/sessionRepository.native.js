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
import { DEFAULT_PAGE_SIZE } from './sessionQuery'

export const ARCHIVE_SCHEMA_VERSION = 1

function invoke(command, args) {
  return globalThis.window.__TAURI__.core.invoke(command, args)
}

/** The JS filter names a range ("week"); SQL needs an absolute bound. Resolve
 *  it here, where the user's timezone and calendar are already known, rather
 *  than reimplementing month arithmetic in Rust. */
function dateBoundFor(dateRange, now = Date.now()) {
  if (!dateRange || dateRange === 'all') return null
  const cutoff = new Date(now)
  if (dateRange === 'week') {
    cutoff.setDate(cutoff.getDate() - 7)
    return cutoff.getTime()
  }
  if (dateRange === 'month') {
    cutoff.setDate(1)
    cutoff.setHours(0, 0, 0, 0)
    return cutoff.getTime()
  }
  return null
}

function toNativeQuery(query = {}) {
  return {
    dateFrom: dateBoundFor(query.dateRange, query.now),
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

export function createNativeSessionRepository() {
  const repository = {
    kind: 'native',

    async loadAll() {
      return invoke('db_load_all')
    },

    async listSessionSummaries(query = {}) {
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
        return { migrated: false, importedCount: 0, reason: 'nothing_to_migrate' }
      }
      // Upgrade recoverable legacy measurements the same way the web build
      // does on startup, so migrated sessions carry the metric they qualify
      // for rather than being frozen as unmeasured.
      const upgraded = legacySessions.map(withSessionFocusMetric)
      return invoke('db_migrate_legacy', {
        sessions: upgraded,
        summaries: upgraded.map(buildSessionSummary),
        ledger: legacyLedger,
      })
    },
  }

  return repository
}
