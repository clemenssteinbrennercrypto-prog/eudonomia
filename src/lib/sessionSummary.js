// The indexed view of a session, computed here and only here.
//
// The native store keeps these as real SQL columns so it can filter and
// paginate without loading every record. It could derive them itself — but
// that would put a second implementation of "is this measured", "what is the
// outcome", "what does search match" on the far side of a language boundary,
// free to drift from focusMetric.js and sessionQuery.js. So JavaScript
// computes them and Rust stores what it is given.
//
// If you add a filter to sessionQuery.js, add its column here too, or the
// native adapter will silently filter on a field it never received.

import { hasMeasuredFocus } from './historyTrend'
import { sessionOutcome } from './sessionQuery'

/** Lowercased haystack for the free-text filter, matching what
 *  `matchesSearch` in sessionQuery.js looks through: task plus tags. */
function searchTextFor(session) {
  const tags = Array.isArray(session?.tags) ? session.tags : []
  return [session?.task || '', ...tags].join(' ').trim().toLowerCase()
}

export function buildSessionSummary(session) {
  const s = session || {}
  return {
    id: s.id || '',
    timestamp: Number.isFinite(s.timestamp) ? s.timestamp : 0,
    task: s.task || '',
    goal: s.goal || '',
    actualSeconds: Number.isFinite(s.actualSeconds) ? s.actualSeconds : 0,
    focusedSeconds: Number.isFinite(s.focusedSeconds) ? s.focusedSeconds : null,
    measuredSeconds: Number.isFinite(s.measuredSeconds) ? s.measuredSeconds : null,
    distractionEvents: Number.isFinite(s.distractionEvents) ? s.distractionEvents : 0,
    // Normalized here so the legacy `goalAchieved` boolean and the modern
    // `goalOutcome` string end up in the same column and filter alike.
    goalOutcome: sessionOutcome(s),
    workspaceId: s.workspace?.id ?? null,
    workspaceRevision: Number.isFinite(s.workspace?.revision) ? s.workspace.revision : null,
    workspaceName: s.workspace?.name ?? null,
    energyLevel: s.energyLevel ?? null,
    completed: Boolean(s.completed),
    measured: hasMeasuredFocus(s),
    tags: Array.isArray(s.tags) ? s.tags : [],
    searchText: searchTextFor(s),
  }
}
