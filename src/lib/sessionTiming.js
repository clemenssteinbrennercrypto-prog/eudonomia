// Wall-clock timing for a session is separate from its active/scored clock.
// `actualSeconds` intentionally stops during a user pause; `startedAt`,
// `endedAt`, and explicit pause intervals preserve when the work happened.

const finite = value => Number.isFinite(value)

export function sessionStartedAt(session) {
  if (finite(session?.startedAt)) return session.startedAt
  if (finite(session?.timestamp) && finite(session?.actualSeconds)) {
    return session.timestamp - Math.max(0, session.actualSeconds) * 1000
  }
  return null
}

export function sessionEndedAt(session) {
  if (finite(session?.endedAt)) return session.endedAt
  if (finite(session?.timestamp)) return session.timestamp
  const startedAt = sessionStartedAt(session)
  return startedAt == null || !finite(session?.actualSeconds)
    ? null
    : startedAt + Math.max(0, session.actualSeconds) * 1000
}

export function sessionWallSeconds(session) {
  if (finite(session?.wallSeconds)) return Math.max(0, session.wallSeconds)
  const startedAt = sessionStartedAt(session)
  const endedAt = sessionEndedAt(session)
  if (startedAt != null && endedAt != null && endedAt >= startedAt) {
    return (endedAt - startedAt) / 1000
  }
  return finite(session?.actualSeconds) ? Math.max(0, session.actualSeconds) : 0
}

export function sessionPauseIntervals(session) {
  if (!Array.isArray(session?.pauseIntervals)) return []
  const startedAt = sessionStartedAt(session)
  const endedAt = sessionEndedAt(session)
  return session.pauseIntervals
    .filter(interval => finite(interval?.startedAt) && finite(interval?.endedAt) && interval.endedAt > interval.startedAt)
    .map(interval => ({
      startedAt: startedAt == null ? interval.startedAt : Math.max(startedAt, interval.startedAt),
      endedAt: endedAt == null ? interval.endedAt : Math.min(endedAt, interval.endedAt),
    }))
    .filter(interval => interval.endedAt > interval.startedAt)
}

// Missing means unknown, not zero. Older records did not preserve pauses, so
// deriving them from wall span minus active time would turn camera startup and
// other historical gaps into made-up user pauses.
export function sessionPausedSeconds(session) {
  if (finite(session?.pausedSeconds)) return Math.max(0, session.pausedSeconds)
  if (!Array.isArray(session?.pauseIntervals)) return null
  return sessionPauseIntervals(session)
    .reduce((total, interval) => total + (interval.endedAt - interval.startedAt) / 1000, 0)
}

export function timelineWallSecond(point) {
  if (finite(point?.wallSecond)) return Math.max(0, point.wallSecond)
  return finite(point?.second) ? Math.max(0, point.second) : null
}
