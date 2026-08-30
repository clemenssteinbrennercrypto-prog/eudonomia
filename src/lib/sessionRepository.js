// The session repository — the one door between the app and stored sessions.
//
// Everything that reads or writes session history goes through this interface.
// That is what makes the backing store replaceable: today it is localStorage
// (bounded at 100 sessions), later a native SQLite database, and potentially a
// synced store after that. Callers never learn which.
//
// ── The interface ───────────────────────────────────────────────────────────
//
//   loadAll()                     -> Session[]        every record, newest first
//   listSessionSummaries(query)   -> { rows, total, page, pageSize, pageCount }
//   getSession(id)                -> Session | null   the complete record
//   saveSession(data)             -> Session          assigns id + timestamp
//   updateSession(id, patch)      -> Session | null
//   deleteSession(id)             -> void
//   clearAll()                    -> void
//   loadFocusLedger()             -> FocusLedgerV1
//   backfillFocusLedger()         -> FocusLedgerV1    startup catch-up
//   exportArchive()               -> { schemaVersion, exportedAt, sessions, focusLedger }
//   migrateLegacyIfNeeded()       -> { migrated, importedCount, ... }
//
// `query` accepts { dateRange, outcome, workspaceId, measurement, search,
// page, pageSize } — see sessionQuery.js, which defines what each filter
// means so every adapter has to agree.
//
// ── Two contracts worth knowing ─────────────────────────────────────────────
//
// 1. `listSessionSummaries` may omit heavy per-session fields (`timeline`,
//    `distractionLog`) so a list view never pays for data it does not draw.
//    Anything that needs the whole record — the session detail report — must
//    call `getSession`. The local adapter happens to return complete records
//    because they are already in memory; do NOT rely on that.
//
// 2. Every method is async. The local adapter resolves immediately, but
//    callers must be written as if a slow disk or IPC hop sits behind it,
//    because eventually one will.

import { createLocalSessionRepository } from './sessionRepository.local'
import { createNativeSessionRepository } from './sessionRepository.native'

/** True inside the native shell, where Tauri commands are reachable. */
export function isNativeRuntime() {
  return Boolean(globalThis.window?.__TAURI__?.core?.invoke)
}

// Chosen once at module load: SQLite in the native app, localStorage in the
// browser and under vitest (which never defines __TAURI__). No caller knows
// which one it got.
export const sessionRepository = isNativeRuntime()
  ? createNativeSessionRepository()
  : createLocalSessionRepository()

export default sessionRepository
