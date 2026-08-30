import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalSessionRepository } from './sessionRepository.local'
import { sessionRepository } from './sessionRepository'
import { ATTENTION_SCORING_VERSION } from './focusMetric'

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

let repo

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
  repo = createLocalSessionRepository()
})

function sessionData(overrides = {}) {
  const actualSeconds = 1800
  return {
    task: 'Thesis',
    actualSeconds,
    measuredSeconds: actualSeconds,
    focusedSeconds: 1400,
    avgFocusScore: 78,
    scoreMeasured: true,
    attentionScoringVersion: ATTENTION_SCORING_VERSION,
    ...overrides,
  }
}

describe('the repository interface', () => {
  // Guards the whole point of the abstraction: a native adapter must be
  // droppable in without any caller changing. If a method is added here it
  // has to exist on every adapter.
  const REQUIRED_METHODS = [
    'loadAll', 'listSessionSummaries', 'getSession', 'saveSession',
    'updateSession', 'deleteSession', 'clearAll', 'loadFocusLedger',
    'backfillFocusLedger', 'exportArchive', 'migrateLegacyIfNeeded',
  ]

  it('exposes every required method', () => {
    for (const method of REQUIRED_METHODS) {
      expect(typeof repo[method], method).toBe('function')
    }
  })

  it('returns a promise from every method, so callers can never depend on sync results', async () => {
    const calls = {
      loadAll: [], listSessionSummaries: [{}], getSession: ['nope'],
      updateSession: ['nope', {}], deleteSession: ['nope'], clearAll: [],
      loadFocusLedger: [], backfillFocusLedger: [], exportArchive: [],
      migrateLegacyIfNeeded: [],
    }
    for (const [method, args] of Object.entries(calls)) {
      const result = repo[method](...args)
      expect(typeof result?.then, method).toBe('function')
      await result
    }
  })

  it('the module default is a usable repository instance', () => {
    expect(sessionRepository.kind).toBe('local')
    for (const method of REQUIRED_METHODS) {
      expect(typeof sessionRepository[method], method).toBe('function')
    }
  })
})

describe('save and read back', () => {
  it('assigns an id and timestamp on save', async () => {
    const saved = await repo.saveSession(sessionData())
    expect(saved.id).toBeTruthy()
    expect(Number.isFinite(saved.timestamp)).toBe(true)
  })

  it('reads a saved session back in full by id', async () => {
    const saved = await repo.saveSession(sessionData({ task: 'Write intro' }))
    const fetched = await repo.getSession(saved.id)
    expect(fetched.task).toBe('Write intro')
  })

  it('returns null rather than throwing for an unknown id', async () => {
    expect(await repo.getSession('does-not-exist')).toBeNull()
  })

  it('returns newest first from loadAll', async () => {
    await repo.saveSession(sessionData({ task: 'first' }))
    await repo.saveSession(sessionData({ task: 'second' }))
    const all = await repo.loadAll()
    expect(all.map(s => s.task)).toEqual(['second', 'first'])
  })
})

describe('listSessionSummaries', () => {
  it('applies filters and pagination together', async () => {
    for (let i = 0; i < 12; i += 1) {
      await repo.saveSession(sessionData({ task: `Task ${i}`, goalOutcome: i % 2 === 0 ? 'yes' : 'no' }))
    }
    const page = await repo.listSessionSummaries({ outcome: 'yes', page: 0, pageSize: 4 })
    expect(page.rows).toHaveLength(4)
    expect(page.total).toBe(6)
    expect(page.pageCount).toBe(2)
    expect(page.rows.every(row => row.goalOutcome === 'yes')).toBe(true)
  })

  it('returns everything when no filters are given', async () => {
    await repo.saveSession(sessionData())
    await repo.saveSession(sessionData())
    const result = await repo.listSessionSummaries({})
    expect(result.total).toBe(2)
  })
})

describe('mutations', () => {
  it('updates a session and returns the updated record', async () => {
    const saved = await repo.saveSession(sessionData())
    const updated = await repo.updateSession(saved.id, { goalOutcome: 'partly', blockerText: 'meetings' })
    expect(updated.goalOutcome).toBe('partly')
    expect(updated.blockerText).toBe('meetings')
    // and it persisted, not just echoed back
    expect((await repo.getSession(saved.id)).goalOutcome).toBe('partly')
  })

  it('deletes one session without touching the others', async () => {
    const keep = await repo.saveSession(sessionData({ task: 'keep' }))
    const drop = await repo.saveSession(sessionData({ task: 'drop' }))
    await repo.deleteSession(drop.id)
    const all = await repo.loadAll()
    expect(all.map(s => s.id)).toEqual([keep.id])
  })

  it('clears every session', async () => {
    await repo.saveSession(sessionData())
    await repo.saveSession(sessionData())
    await repo.clearAll()
    expect(await repo.loadAll()).toEqual([])
  })
})

describe('focus ledger stays in step with sessions', () => {
  function measuredSession() {
    const startedAt = Date.now() - 40 * 60 * 1000
    return sessionData({
      startedAt,
      endedAt: Date.now(),
      actualSeconds: 2420,
      measuredSeconds: 2400,
      scoreSum: 180_000,
      focusedSeconds: 2000,
      sessionEfficiency: 75,
      deepFocusMinutes: 40,
      focusMetricVersion: 1,
      focusPhases: { seconds: { arrival: 0, ramp: 0, lock_in: 2400, fade: 0, recovery: 0, drift: 0 } },
    })
  }

  it('records a ledger contribution when a qualifying session is saved', async () => {
    await repo.saveSession(measuredSession())
    const ledger = await repo.loadFocusLedger()
    expect(Object.keys(ledger.days).length).toBe(1)
  })

  it('removes the ledger contribution when that session is deleted', async () => {
    const saved = await repo.saveSession(measuredSession())
    await repo.deleteSession(saved.id)
    const ledger = await repo.loadFocusLedger()
    const remaining = Object.values(ledger.days).flatMap(day => Object.keys(day.sessions || {}))
    expect(remaining).toEqual([])
  })

  it('empties the ledger together with the sessions on clearAll', async () => {
    await repo.saveSession(measuredSession())
    await repo.clearAll()
    const ledger = await repo.loadFocusLedger()
    expect(ledger.days).toEqual({})
  })
})

describe('export', () => {
  it('exports sessions and the ledger together with a schema version', async () => {
    await repo.saveSession(sessionData({ task: 'Exported' }))
    const archive = await repo.exportArchive()
    expect(archive.schemaVersion).toBe(1)
    expect(archive.sessions).toHaveLength(1)
    expect(archive.sessions[0].task).toBe('Exported')
    expect(archive.focusLedger).toBeTruthy()
    expect(typeof archive.exportedAt).toBe('string')
  })

  it('exports the complete record, timeline included, not a summary', async () => {
    const timeline = [{ second: 0, score: 80, phase: 'lock_in' }]
    await repo.saveSession(sessionData({ timeline }))
    const archive = await repo.exportArchive()
    expect(archive.sessions[0].timeline).toEqual(timeline)
  })
})

describe('migration', () => {
  it('reports a no-op, since this adapter is itself the legacy store', async () => {
    expect(await repo.migrateLegacyIfNeeded()).toMatchObject({ migrated: false, importedCount: 0 })
  })
})
