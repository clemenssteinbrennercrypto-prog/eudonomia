import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_SIZE, filterSessions, paginate, sessionOutcome } from './sessionQuery'

const NOW = new Date(2026, 7, 15, 12, 0, 0).getTime()
const DAY = 24 * 60 * 60 * 1000

function session({ id = 's', daysAgo = 0, pct = 70, extra = {} } = {}) {
  const actualSeconds = 1800
  return {
    id,
    timestamp: NOW - daysAgo * DAY,
    actualSeconds,
    measuredSeconds: actualSeconds,
    focusedSeconds: Math.round(actualSeconds * (pct / 100)),
    avgFocusScore: pct,
    scoreMeasured: true,
    ...extra,
  }
}

describe('sessionOutcome', () => {
  it('reads the modern goalOutcome field', () => {
    expect(sessionOutcome({ goalOutcome: 'partly' })).toBe('partly')
  })

  it('normalizes the legacy goalAchieved boolean both ways', () => {
    expect(sessionOutcome({ goalAchieved: true })).toBe('yes')
    expect(sessionOutcome({ goalAchieved: false })).toBe('no')
  })

  it('returns null when the outcome was never recorded', () => {
    expect(sessionOutcome({})).toBeNull()
    expect(sessionOutcome(null)).toBeNull()
  })
})

describe('filterSessions', () => {
  it('is the identity filter when no filters are set', () => {
    const list = [session({ id: 'a' }), session({ id: 'b' })]
    expect(filterSessions(list, {})).toHaveLength(2)
  })

  it('preserves input order', () => {
    const list = [session({ id: 'a' }), session({ id: 'b' }), session({ id: 'c' })]
    expect(filterSessions(list, {}).map(s => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('filters to the last seven days for the week range', () => {
    const list = [session({ id: 'recent', daysAgo: 2 }), session({ id: 'old', daysAgo: 20 })]
    expect(filterSessions(list, { dateRange: 'week', now: NOW }).map(s => s.id)).toEqual(['recent'])
  })

  it('filters to the current calendar month for the month range', () => {
    const thisMonth = session({ id: 'this', daysAgo: 3 })
    const lastMonth = session({ id: 'last', daysAgo: 40 })
    expect(filterSessions([thisMonth, lastMonth], { dateRange: 'month', now: NOW }).map(s => s.id)).toEqual(['this'])
  })

  it('drops records with an unusable timestamp from any dated range', () => {
    const broken = { id: 'broken', timestamp: NaN }
    expect(filterSessions([broken], { dateRange: 'week', now: NOW })).toEqual([])
    // ...but an untimed "all" query still shows it, so it stays reachable.
    expect(filterSessions([broken], { dateRange: 'all' })).toHaveLength(1)
  })

  it('filters by outcome, treating legacy booleans the same as modern values', () => {
    const list = [
      session({ id: 'modern', extra: { goalOutcome: 'yes' } }),
      session({ id: 'legacy', extra: { goalAchieved: true } }),
      session({ id: 'missed', extra: { goalOutcome: 'no' } }),
    ]
    expect(filterSessions(list, { outcome: 'yes' }).map(s => s.id)).toEqual(['modern', 'legacy'])
  })

  it('filters unrated sessions as their own bucket', () => {
    const list = [session({ id: 'rated', extra: { goalOutcome: 'yes' } }), session({ id: 'unrated' })]
    expect(filterSessions(list, { outcome: 'unrated' }).map(s => s.id)).toEqual(['unrated'])
  })

  it('filters by workspace id', () => {
    const list = [
      session({ id: 'office', extra: { workspace: { id: 'ws1', name: 'Office' } } }),
      session({ id: 'home', extra: { workspace: { id: 'ws2', name: 'Home' } } }),
      session({ id: 'none' }),
    ]
    expect(filterSessions(list, { workspaceId: 'ws1' }).map(s => s.id)).toEqual(['office'])
  })

  it('filters by measurement status', () => {
    const measured = session({ id: 'measured' })
    const unmeasured = session({ id: 'unmeasured', extra: { scoreMeasured: false } })
    const list = [measured, unmeasured]
    expect(filterSessions(list, { measurement: 'measured' }).map(s => s.id)).toEqual(['measured'])
    expect(filterSessions(list, { measurement: 'unmeasured' }).map(s => s.id)).toEqual(['unmeasured'])
  })

  it('searches task text case-insensitively', () => {
    const list = [session({ id: 'a', extra: { task: 'Write Thesis' } }), session({ id: 'b', extra: { task: 'Review PR' } })]
    expect(filterSessions(list, { search: 'thesis' }).map(s => s.id)).toEqual(['a'])
  })

  it('searches tags as well as the task', () => {
    const list = [session({ id: 'a', extra: { task: 'Something', tags: ['deep-work'] } })]
    expect(filterSessions(list, { search: 'deep' }).map(s => s.id)).toEqual(['a'])
  })

  it('combines filters conjunctively', () => {
    const list = [
      session({ id: 'hit', daysAgo: 1, extra: { task: 'Thesis', goalOutcome: 'yes' } }),
      session({ id: 'wrongOutcome', daysAgo: 1, extra: { task: 'Thesis', goalOutcome: 'no' } }),
      session({ id: 'wrongDate', daysAgo: 30, extra: { task: 'Thesis', goalOutcome: 'yes' } }),
    ]
    const result = filterSessions(list, { dateRange: 'week', outcome: 'yes', search: 'thesis', now: NOW })
    expect(result.map(s => s.id)).toEqual(['hit'])
  })

  it('survives a null or non-array input', () => {
    expect(filterSessions(null, {})).toEqual([])
    expect(filterSessions([null, undefined], {})).toEqual([])
  })
})

describe('paginate', () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}` }))

  it('returns the requested page and the unpaginated total', () => {
    const result = paginate(rows, { page: 0, pageSize: 10 })
    expect(result.rows).toHaveLength(10)
    expect(result.rows[0].id).toBe('s0')
    expect(result.total).toBe(25)
    expect(result.pageCount).toBe(3)
  })

  it('returns the correct slice for a later page', () => {
    expect(paginate(rows, { page: 2, pageSize: 10 }).rows.map(r => r.id)).toEqual(['s20', 's21', 's22', 's23', 's24'])
  })

  it('yields an empty page rather than throwing when the page is past the end', () => {
    const result = paginate(rows, { page: 99, pageSize: 10 })
    expect(result.rows).toEqual([])
    expect(result.total).toBe(25)
  })

  it('always reports at least one page, even for no rows', () => {
    expect(paginate([], {}).pageCount).toBe(1)
  })

  it('falls back to the default page size for nonsense input', () => {
    expect(paginate(rows, { pageSize: 0 }).pageSize).toBe(DEFAULT_PAGE_SIZE)
    expect(paginate(rows, { page: -5 }).page).toBe(0)
  })
})
