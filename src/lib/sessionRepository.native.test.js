import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNativeSessionRepository } from './sessionRepository.native'
import { createLocalSessionRepository } from './sessionRepository.local'
import { buildSessionSummary } from './sessionSummary'
import { ATTENTION_SCORING_VERSION } from './focusMetric'

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

let invoked
let repo

// Stands in for the Rust side: records what it was asked to do and returns
// plausible shapes. This test is about the JS half of the boundary — the SQL
// itself is covered by the Rust tests in db.rs.
function fakeInvoke(handlers = {}) {
  return vi.fn(async (command, args) => {
    invoked.push({ command, args })
    if (handlers[command]) return handlers[command](args)
    if (command === 'db_load_focus_ledger') return { schemaVersion: 1, days: {} }
    if (command === 'db_load_all') return []
    if (command === 'db_list_session_summaries') {
      return { rows: [], total: 0, page: 0, pageSize: 10, pageCount: 1 }
    }
    return null
  })
}

beforeEach(() => {
  invoked = []
  globalThis.localStorage = new MemoryStorage()
  globalThis.window = { __TAURI__: { core: { invoke: fakeInvoke() } } }
  repo = createNativeSessionRepository()
})

afterEach(() => {
  delete globalThis.window
  vi.restoreAllMocks()
})

function sessionData(overrides = {}) {
  return {
    task: 'Thesis',
    actualSeconds: 1800,
    measuredSeconds: 1800,
    focusedSeconds: 1400,
    avgFocusScore: 78,
    scoreMeasured: true,
    attentionScoringVersion: ATTENTION_SCORING_VERSION,
    ...overrides,
  }
}

const sent = (command) => invoked.find(call => call.command === command)?.args
const called = (command) => invoked.some(call => call.command === command)

describe('interface parity with the local adapter', () => {
  it('exposes exactly the same methods', () => {
    const local = createLocalSessionRepository()
    const localMethods = Object.keys(local).filter(key => typeof local[key] === 'function').sort()
    const nativeMethods = Object.keys(repo).filter(key => typeof repo[key] === 'function').sort()
    expect(nativeMethods).toEqual(localMethods)
  })

  it('identifies itself as the native adapter', () => {
    expect(repo.kind).toBe('native')
  })
})

describe('saving', () => {
  it('assigns an id and timestamp before handing the record over', async () => {
    const saved = await repo.saveSession(sessionData())
    expect(saved.id).toBeTruthy()
    expect(Number.isFinite(saved.timestamp)).toBe(true)
    expect(sent('db_save_session').session.id).toBe(saved.id)
  })

  it('computes the indexed summary in JS rather than leaving it to SQL', async () => {
    await repo.saveSession(sessionData({ task: 'Write intro', tags: ['deep-work'] }))
    const summary = sent('db_save_session').summary
    expect(summary.task).toBe('Write intro')
    expect(summary.measured).toBe(true)
    // The search column must already be lowercased and include tags.
    expect(summary.searchText).toBe('write intro deep-work')
  })

  it('sends the ledger day alongside the session so both land in one transaction', async () => {
    const startedAt = new Date(2026, 7, 15, 10, 0, 0).getTime()
    await repo.saveSession(sessionData({
      startedAt,
      timestamp: startedAt,
      scoreSum: 140_000,
      sessionEfficiency: 78,
      deepFocusMinutes: 30,
      focusMetricVersion: 1,
      focusPhases: { seconds: { arrival: 0, ramp: 0, lock_in: 1800, fade: 0, recovery: 0, drift: 0 } },
    }))
    const args = sent('db_save_session')
    expect(args.ledgerDayKey).toBe('2026-08-15')
    expect(args.ledgerDayEntry).toBeTruthy()
  })

  it('stores a versioned analysis snapshot with the record', async () => {
    await repo.saveSession(sessionData({ goalOutcome: 'yes' }))
    const analysis = sent('db_save_session').analysis
    expect(analysis.version).toBe(1)
    expect(analysis.status).toBe('ready')
  })
})

describe('querying', () => {
  it('resolves a named date range into an absolute bound for SQL', async () => {
    const now = new Date(2026, 7, 15, 12, 0, 0).getTime()
    await repo.listSessionSummaries({ dateRange: 'week', now })
    const query = sent('db_list_session_summaries').query
    expect(query.dateFrom).toBe(new Date(2026, 7, 8, 12, 0, 0).getTime())
  })

  it('resolves a month range to the first of the month', async () => {
    const now = new Date(2026, 7, 15, 12, 0, 0).getTime()
    await repo.listSessionSummaries({ dateRange: 'month', now })
    expect(sent('db_list_session_summaries').query.dateFrom)
      .toBe(new Date(2026, 7, 1, 0, 0, 0, 0).getTime())
  })

  it('sends no date bound at all for the "all" range', async () => {
    await repo.listSessionSummaries({ dateRange: 'all' })
    expect(sent('db_list_session_summaries').query.dateFrom).toBeNull()
  })

  it('normalizes "all" filter values to null instead of passing them through', async () => {
    await repo.listSessionSummaries({ outcome: 'all', workspaceId: 'all', measurement: 'all' })
    const query = sent('db_list_session_summaries').query
    expect(query.outcome).toBeNull()
    expect(query.workspaceId).toBeNull()
    expect(query.measurement).toBeNull()
  })

  it('passes real filter values through untouched', async () => {
    await repo.listSessionSummaries({ outcome: 'partly', workspaceId: 'ws1', measurement: 'measured', search: 'thesis' })
    const query = sent('db_list_session_summaries').query
    expect(query).toMatchObject({
      outcome: 'partly', workspaceId: 'ws1', measurement: 'measured', search: 'thesis',
    })
  })

  it('defaults pagination rather than sending undefined', async () => {
    await repo.listSessionSummaries({})
    expect(sent('db_list_session_summaries').query).toMatchObject({ page: 0, pageSize: 10 })
  })
})

describe('updating', () => {
  it('regenerates the analysis snapshot from the merged record', async () => {
    const existing = { id: 'a', ...sessionData(), goalOutcome: null }
    globalThis.window.__TAURI__.core.invoke = fakeInvoke({
      db_get_session: () => existing,
      db_update_session: (args) => ({ ...existing, ...args.patch }),
    })
    repo = createNativeSessionRepository()

    await repo.updateSession('a', { goalOutcome: 'yes' })
    const args = sent('db_update_session')
    // The snapshot must reflect the patched outcome, not the stale one.
    expect(args.analysis.goalOutcome).toBe('yes')
    expect(args.analysis.status).toBe('ready')
    expect(args.summary.goalOutcome).toBe('yes')
  })

  it('returns null without writing when the session does not exist', async () => {
    globalThis.window.__TAURI__.core.invoke = fakeInvoke({ db_get_session: () => null })
    repo = createNativeSessionRepository()

    expect(await repo.updateSession('ghost', { goalOutcome: 'yes' })).toBeNull()
    expect(sent('db_update_session')).toBeUndefined()
  })
})

// The failure that shipped: the app auto-updates, switches to reading SQLite,
// and shows an empty history while every session is still sitting in
// localStorage. Nothing was deleted and it made no difference — from the
// user's side their data was gone. Reads must not leave the old store until
// the import is confirmed.
describe('never shows an empty app while history is still in the old store', () => {
  const legacyRows = [
    { id: 'a', task: 'Old one', timestamp: 1, actualSeconds: 600, focusedSeconds: 400 },
    { id: 'b', task: 'Old two', timestamp: 2, actualSeconds: 600, focusedSeconds: 400 },
  ]

  function withLegacyHistory() {
    localStorage.setItem('eudaimonia_sessions', JSON.stringify(legacyRows))
  }

  it('reads from the legacy store before the import has run', async () => {
    withLegacyHistory()
    // SQLite is empty at this point — db_load_all would answer with nothing.
    const all = await repo.loadAll()
    expect(all.map(s => s.id)).toEqual(['a', 'b'])
    expect(called('db_load_all')).toBe(false)
  })

  it('keeps reading from the legacy store when the import is not verified', async () => {
    withLegacyHistory()
    globalThis.window.__TAURI__.core.invoke = fakeInvoke({
      db_migrate_legacy: () => ({ migrated: false, verified: false, reason: 'rolled back' }),
    })
    repo = createNativeSessionRepository()

    await repo.migrateLegacyIfNeeded()
    expect(repo.migrated).toBe(false)
    expect((await repo.loadAll()).map(s => s.id)).toEqual(['a', 'b'])
  })

  it('keeps reading from the legacy store when the import throws', async () => {
    withLegacyHistory()
    globalThis.window.__TAURI__.core.invoke = fakeInvoke({
      db_migrate_legacy: () => { throw new Error('database locked') },
    })
    repo = createNativeSessionRepository()

    await expect(repo.migrateLegacyIfNeeded()).rejects.toThrow('database locked')
    expect((await repo.loadAll()).map(s => s.id)).toEqual(['a', 'b'])
  })

  it('hands over to SQLite only once the import is verified', async () => {
    withLegacyHistory()
    globalThis.window.__TAURI__.core.invoke = fakeInvoke({
      db_migrate_legacy: () => ({ migrated: true, importedCount: 2, verified: true }),
      db_load_all: () => [{ id: 'a' }, { id: 'b' }],
    })
    repo = createNativeSessionRepository()

    await repo.migrateLegacyIfNeeded()
    expect(repo.migrated).toBe(true)
    await repo.loadAll()
    expect(called('db_load_all')).toBe(true)
  })

  it('uses SQLite immediately when there is no legacy history to lose', async () => {
    await repo.migrateLegacyIfNeeded()
    expect(repo.migrated).toBe(true)
    await repo.loadAll()
    expect(called('db_load_all')).toBe(true)
  })

  // Reads falling back while writes did not was worse than either alone: a
  // delete removed a row from the empty database and the session stayed on
  // screen, and a newly finished session was written somewhere nothing was
  // reading from.
  it('deletes from the store it is reading from', async () => {
    withLegacyHistory()
    await repo.deleteSession('a')
    expect(called('db_delete_session')).toBe(false)
    expect((await repo.loadAll()).map(s => s.id)).toEqual(['b'])
  })

  it('saves a new session where it will still be visible', async () => {
    withLegacyHistory()
    const saved = await repo.saveSession({ task: 'Fresh', actualSeconds: 600 })
    expect(called('db_save_session')).toBe(false)
    expect((await repo.loadAll()).map(s => s.id)).toContain(saved.id)
  })

  it('applies an outcome edit to the store it is reading from', async () => {
    withLegacyHistory()
    await repo.updateSession('a', { goalOutcome: 'yes' })
    expect(called('db_update_session')).toBe(false)
    expect((await repo.getSession('a')).goalOutcome).toBe('yes')
  })

  it('clears the store it is reading from', async () => {
    withLegacyHistory()
    await repo.clearAll()
    expect(called('db_clear_all')).toBe(false)
    expect(await repo.loadAll()).toEqual([])
  })

  it('serves the ledger and session detail from the legacy store too', async () => {
    withLegacyHistory()
    expect(await repo.getSession('a')).toMatchObject({ task: 'Old one' })
    expect(await repo.loadFocusLedger()).toBeTruthy()
    expect(called('db_get_session')).toBe(false)
    expect(called('db_load_focus_ledger')).toBe(false)
  })
})

describe('legacy migration', () => {
  it('does nothing when there is no localStorage history', async () => {
    const result = await repo.migrateLegacyIfNeeded()
    expect(result).toMatchObject({ migrated: false, reason: 'nothing_to_migrate' })
    expect(sent('db_migrate_legacy')).toBeUndefined()
  })

  it('sends every legacy session with a matching summary', async () => {
    localStorage.setItem('eudaimonia_sessions', JSON.stringify([
      { id: 'a', task: 'Old one', timestamp: 1, actualSeconds: 600, focusedSeconds: 400 },
      { id: 'b', task: 'Old two', timestamp: 2, actualSeconds: 600, focusedSeconds: 400 },
    ]))
    globalThis.window.__TAURI__.core.invoke = fakeInvoke({
      db_migrate_legacy: () => ({ migrated: true, importedCount: 2, verified: true }),
    })
    repo = createNativeSessionRepository()

    const result = await repo.migrateLegacyIfNeeded()
    expect(result.migrated).toBe(true)
    const args = sent('db_migrate_legacy')
    expect(args.sessions).toHaveLength(2)
    // Rust rejects a length mismatch, so these must always be parallel.
    expect(args.summaries).toHaveLength(2)
    expect(args.summaries[0].id).toBe('a')
  })

  it('never removes the localStorage copy, even after a successful import', async () => {
    localStorage.setItem('eudaimonia_sessions', JSON.stringify([
      { id: 'a', task: 'Old', timestamp: 1, actualSeconds: 600, focusedSeconds: 400 },
    ]))
    globalThis.window.__TAURI__.core.invoke = fakeInvoke({
      db_migrate_legacy: () => ({ migrated: true, importedCount: 1, verified: true }),
    })
    repo = createNativeSessionRepository()

    await repo.migrateLegacyIfNeeded()
    expect(localStorage.getItem('eudaimonia_sessions')).not.toBeNull()
  })
})

describe('summary columns match the JS filter semantics', () => {
  it('normalizes a legacy goalAchieved boolean into the outcome column', () => {
    expect(buildSessionSummary({ goalAchieved: true }).goalOutcome).toBe('yes')
    expect(buildSessionSummary({ goalAchieved: false }).goalOutcome).toBe('no')
    expect(buildSessionSummary({}).goalOutcome).toBeNull()
  })

  it('marks an unmeasured session as such', () => {
    expect(buildSessionSummary(sessionData()).measured).toBe(true)
    expect(buildSessionSummary(sessionData({ scoreMeasured: false })).measured).toBe(false)
  })

  // The live accumulator counts in fractions, so a real record's
  // focusedSeconds is 92.59400000000004 rather than 93. Sending that as an
  // index column is what made the native import reject an entire history.
  it('rounds the fractional seconds real records carry', () => {
    const summary = buildSessionSummary({
      id: 'real',
      timestamp: 1_787_440_169_711,
      actualSeconds: 620.0000000001,
      focusedSeconds: 92.59400000000004,
      measuredSeconds: 600.5,
      workspace: { id: 'ws1', revision: 0 },
    })
    expect(summary.focusedSeconds).toBe(93)
    expect(summary.measuredSeconds).toBe(601)
    expect(summary.actualSeconds).toBe(620)
    expect(Number.isInteger(summary.timestamp)).toBe(true)
  })

  it('survives a record missing every optional field', () => {
    const summary = buildSessionSummary({ id: 'x' })
    expect(summary.workspaceId).toBeNull()
    expect(summary.tags).toEqual([])
    expect(summary.searchText).toBe('')
  })
})
