// What a session filter MEANS, as one pure function.
//
// This exists so the meaning of a query lives in exactly one place. Today the
// localStorage adapter runs it over an in-memory array; when the native SQLite
// adapter lands it has to translate these same semantics into SQL. Having them
// written down and unit-tested here is what makes "the two adapters agree" a
// checkable claim instead of a hope.
//
// Keep this free of storage and React imports — it is data in, data out.

import { hasMeasuredFocus } from './historyTrend'

export const DEFAULT_PAGE_SIZE = 10

/** Legacy records predate `goalOutcome` and carry a boolean instead. Both
 *  spellings mean the same thing and must filter identically. */
export function sessionOutcome(session) {
  if (session?.goalOutcome) return session.goalOutcome
  if (session?.goalAchieved === true) return 'yes'
  if (session?.goalAchieved === false) return 'no'
  return null
}

function matchesDateRange(session, range, now) {
  if (!range || range === 'all') return true
  const timestamp = session?.timestamp
  if (!Number.isFinite(timestamp)) return false
  const cutoff = new Date(now)
  if (range === 'week') {
    cutoff.setDate(cutoff.getDate() - 7)
  } else if (range === 'month') {
    cutoff.setDate(1)
    cutoff.setHours(0, 0, 0, 0)
  } else {
    return true
  }
  return timestamp >= cutoff.getTime()
}

function matchesSearch(session, search) {
  const query = String(search || '').trim().toLowerCase()
  if (!query) return true
  const task = String(session?.task || '').toLowerCase()
  if (task.includes(query)) return true
  const tags = Array.isArray(session?.tags) ? session.tags : []
  return tags.some(tag => String(tag).toLowerCase().includes(query))
}

/**
 * Apply every filter in `query` to `sessions`. Order is preserved — callers
 * hand in newest-first records and get newest-first results back.
 *
 * Unset/`'all'` filters match everything, so `filterSessions(list, {})` is the
 * identity filter.
 */
export function filterSessions(sessions, query = {}) {
  const {
    dateRange = 'all',
    outcome = 'all',
    workspaceId = 'all',
    measurement = 'all',
    search = '',
    now = Date.now(),
  } = query

  return (Array.isArray(sessions) ? sessions : []).filter(session => {
    if (!session) return false
    if (!matchesDateRange(session, dateRange, now)) return false
    if (outcome !== 'all' && (sessionOutcome(session) || 'unrated') !== outcome) return false
    if (workspaceId !== 'all' && session.workspace?.id !== workspaceId) return false
    if (measurement !== 'all' && hasMeasuredFocus(session) !== (measurement === 'measured')) return false
    if (!matchesSearch(session, search)) return false
    return true
  })
}

/**
 * One page of results plus the unpaginated total, which is what a list view
 * needs to render "11–20 of 47" and decide whether Next is enabled.
 *
 * `page` is zero-based. An out-of-range page yields an empty `rows` rather
 * than throwing — deleting the last item on the last page must not crash the
 * view that was showing it.
 */
export function paginate(rows, { page = 0, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.trunc(pageSize) : DEFAULT_PAGE_SIZE
  const safePage = Number.isFinite(page) && page > 0 ? Math.trunc(page) : 0
  const start = safePage * safeSize
  return {
    rows: safeRows.slice(start, start + safeSize),
    total: safeRows.length,
    page: safePage,
    pageSize: safeSize,
    pageCount: Math.max(1, Math.ceil(safeRows.length / safeSize)),
  }
}
