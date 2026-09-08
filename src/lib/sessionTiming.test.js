import { describe, expect, it } from 'vitest'
import {
  sessionEndedAt,
  sessionPausedSeconds,
  sessionPauseIntervals,
  sessionStartedAt,
  sessionWallSeconds,
  timelineWallSecond,
} from './sessionTiming'

describe('session wall-clock timing', () => {
  it('keeps explicit wall time separate from active time', () => {
    const startedAt = new Date(2026, 8, 8, 14, 0).getTime()
    const endedAt = new Date(2026, 8, 8, 18, 0).getTime()
    const session = {
      startedAt,
      endedAt,
      actualSeconds: 3600,
      wallSeconds: 4 * 3600,
      pausedSeconds: 3 * 3600,
      pauseIntervals: [{
        startedAt: new Date(2026, 8, 8, 14, 30).getTime(),
        endedAt: new Date(2026, 8, 8, 17, 30).getTime(),
      }],
    }

    expect(sessionStartedAt(session)).toBe(startedAt)
    expect(sessionEndedAt(session)).toBe(endedAt)
    expect(sessionWallSeconds(session)).toBe(4 * 3600)
    expect(sessionPausedSeconds(session)).toBe(3 * 3600)
    expect(sessionPauseIntervals(session)).toEqual(session.pauseIntervals)
  })

  it('does not invent pauses for a legacy session', () => {
    const timestamp = new Date(2026, 8, 8, 18, 0).getTime()
    const legacy = { timestamp, actualSeconds: 3600 }

    expect(sessionStartedAt(legacy)).toBe(timestamp - 3600 * 1000)
    expect(sessionPausedSeconds(legacy)).toBeNull()
    expect(sessionPauseIntervals(legacy)).toEqual([])
  })

  it('uses wall offsets when present without rewriting legacy active offsets', () => {
    expect(timelineWallSecond({ second: 1800, wallSecond: 12_600 })).toBe(12_600)
    expect(timelineWallSecond({ second: 1800 })).toBe(1800)
  })
})
