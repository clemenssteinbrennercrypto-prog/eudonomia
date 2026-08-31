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
import {
  addSessionToFocusLedger,
  backfillFocusLedger as rebuildFocusLedger,
  emptyFocusLedger,
  localDayKey,
  withSessionFocusMetric,
} from './focusMetric'
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
  let readyPromise = null

  async function migrateLegacyOnce() {
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
  }

  /**
   * Settle which store is authoritative, once, before anything reads.
   *
   * This used to be decided per call, which raced the app's own startup: the
   * first screens called loadAll() while the import had not finished, saw
   * localStorage still holding rows, and answered from there — so the app
   * showed the old capped copy while the real history sat in SQLite. Worse, it
   * was re-decided on every call, so different parts of one screen could
   * disagree about where the data lived.
   *
   * Every method awaits this, so the question is answered once per launch and
   * every caller gets the same answer. A failed import resolves too: reads
   * then stay on the legacy store, which is the safe side.
   */
  function ensureReady() {
    if (!readyPromise) {
      readyPromise = migrateLegacyOnce().catch(error => ({
        migrated: false,
        importedCount: 0,
        verified: false,
        reason: String(error?.message || error),
      }))
    }
    return readyPromise
  }

  /** True while the old store still holds the only copy of anything. */
  async function servedByLegacy() {
    await ensureReady()
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
      // Writing to SQLite while reads still come from localStorage would make
      // a finished session vanish the moment it was saved. Both sides have to
      // point at the same store.
      if (await servedByLegacy()) return legacy.saveSession(sessionData)
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
      if (await servedByLegacy()) return legacy.updateSession(id, patch)
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
      // Deleting from an empty database silently succeeded while the row the
      // user was looking at sat untouched in localStorage — so the session
      // simply would not go away.
      if (await servedByLegacy()) return legacy.deleteSession(id)
      await invoke('db_delete_session', { id })
    },

    async clearAll() {
      if (await servedByLegacy()) return legacy.clearAll()
      await invoke('db_clear_all')
    },

    async loadFocusLedger() {
      if (await servedByLegacy()) return legacy.loadFocusLedger()
      return invoke('db_load_focus_ledger')
    },

    /**
     * Re-derive every stored session's focus metric and rebuild the ledger
     * from the result.
     *
     * This exists because scoring rules change. When the native V2 camera
     * became a scoreable ruler, every V2 session already on disk still carried
     * the refusal it was written with — `focusMetricRejection` on the record,
     * an "unmeasured" marker in the ledger — so new sessions counted while the
     * user's existing ones stayed invisible to the daily score. A metric that
     * only applies to sessions recorded after the rule changed is not a fixed
     * metric.
     *
     * Idempotent once settled. Native persistence receives one atomic batch
     * per start regardless of history size, instead of one IPC transaction per
     * changed session. Safe to run on every start, which is where it is called
     * from.
     */
    async backfillFocusLedger() {
      // If the verified handover failed, every operation stays on the legacy
      // adapter. Rebuilding SQLite in that state would make the ledger and the
      // sessions come from different stores — the same split-brain failure the
      // migration guard exists to prevent.
      if (await servedByLegacy()) return legacy.backfillFocusLedger()

      const sessions = await repository.loadAll()
      const upgraded = sessions.map(withSessionFocusMetric)
      const updates = []

      // Prepare only the records whose derivation actually changed. Rust
      // applies this batch and the rebuilt ledger in one transaction: a bad
      // historical row can no longer leave half the sessions re-derived while
      // the old ledger remains on screen.
      for (let index = 0; index < sessions.length; index += 1) {
        const before = sessions[index]
        const after = upgraded[index]
        if (!before?.id) continue
        const changed = before.focusMetricRejection !== after.focusMetricRejection ||
          before.sessionEfficiency !== after.sessionEfficiency ||
          before.deepFocusMinutes !== after.deepFocusMinutes ||
          before.focusMetricVersion !== after.focusMetricVersion
        if (!changed) continue
        updates.push({
          id: before.id,
          patch: {
            focusMetricVersion: after.focusMetricVersion,
            focusMetricRejection: after.focusMetricRejection,
            sessionEfficiency: after.sessionEfficiency,
            deepFocusSeconds: after.deepFocusSeconds,
            deepFocusMinutes: after.deepFocusMinutes,
            measurementCoverage: after.measurementCoverage,
            scoringGeneration: after.scoringGeneration ?? null,
          },
          summary: buildSessionSummary(after),
          analysis: analyzeSession(after),
        })
      }

      // Rebuilt from scratch rather than patched, so a contribution that is no
      // longer valid disappears instead of lingering from an earlier ruleset.
      // The native transaction lands it together with every changed record.
      const ledger = rebuildFocusLedger(emptyFocusLedger(), upgraded)
      await invoke('db_apply_focus_backfill', { updates, ledger })
      return ledger
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
      return ensureReady()
    },
  }

  return repository
}
