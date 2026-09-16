import { describe, expect, it } from 'vitest'
import { changeFocusScoreSchedule, normalizeFocusScoreSchedule, scheduleForDay } from './focusScoreSchedule'

describe('dated workday settings', () => {
  it('starts today without inventing a historical plan, then schedules edits for tomorrow', () => {
    const first = changeFocusScoreSchedule(null, [1, 2, 3, 4, 5], new Date(2026, 8, 16, 10))
    expect(scheduleForDay(first, '2026-09-15')).toBeNull()
    const next = changeFocusScoreSchedule(first, [0, 6], new Date(2026, 8, 16, 11))
    expect(scheduleForDay(next, '2026-09-16').workdays).toEqual([1, 2, 3, 4, 5])
    expect(scheduleForDay(next, '2026-09-17').workdays).toEqual([0, 6])
    expect(first.plans).toHaveLength(1)
  })

  it('replaces only a pending edit when saved twice today', () => {
    const first = changeFocusScoreSchedule(null, [1], new Date(2026, 8, 16))
    const second = changeFocusScoreSchedule(first, [2], new Date(2026, 8, 16))
    const third = changeFocusScoreSchedule(second, [3], new Date(2026, 8, 16))
    expect(third.plans).toEqual([
      { effectiveFrom: '2026-09-16', workdays: [1] },
      { effectiveFrom: '2026-09-17', workdays: [3] },
    ])
  })

  it('rejects empty or invalid selections and malformed stored dates', () => {
    for (const days of [[], [1, 1], [7], ['1']]) expect(() => changeFocusScoreSchedule(null, days)).toThrow()
    expect(normalizeFocusScoreSchedule({ version: 1, plans: [
      { effectiveFrom: '2026-02-31', workdays: [1] },
      { effectiveFrom: '2026-09-16', workdays: [] },
    ] }).plans).toEqual([])
  })

  it('uses calendar tomorrow across the DST boundary', () => {
    const previousTimezone = process.env.TZ
    process.env.TZ = 'Europe/Vienna'
    try {
      const first = changeFocusScoreSchedule(null, [1], new Date(2026, 9, 24, 23, 30))
      expect(changeFocusScoreSchedule(first, [2], new Date(2026, 9, 25, 0, 30)).plans.at(-1).effectiveFrom)
        .toBe('2026-10-26')
    } finally {
      if (previousTimezone == null) delete process.env.TZ
      else process.env.TZ = previousTimezone
    }
  })
})
