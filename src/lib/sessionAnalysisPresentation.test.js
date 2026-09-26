import { describe, expect, it } from 'vitest'
import { describeConclusion, fmtClock } from './sessionAnalysisPresentation'

describe('session analysis presentation', () => {
  it('shows an explicit hour field in long-session timestamps', () => {
    expect(fmtClock(59 * 60 + 59)).toBe('59:59')
    expect(fmtClock(60 * 60)).toBe('1:00:00')
    expect(fmtClock(75 * 60 + 30)).toBe('1:15:30')
  })

  it('describes incompatible measurements without version jargon', () => {
    const copy = describeConclusion({ code: 'SCORING_VERSION_INCOMPATIBLE' }, {})
    expect(copy.headline).toContain('different camera measurement method')
    expect(copy.headline).not.toMatch(/version|ruler/i)
  })
})
