import { beforeEach, describe, expect, it } from 'vitest'
import {
  FOCUS_LEDGER_KEY,
  backfillFocusLedgerFromSessions,
  clearAllSessions,
  deleteSession,
  loadFocusLedger,
  loadSessions,
  saveSession,
} from './storage'
import { ATTENTION_SCORING_VERSION, FOCUS_METRIC_V1 } from './focusMetric'

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

function validSession(startedAt = new Date(2026, 7, 17, 9).getTime()) {
  return {
    startedAt,
    attentionScoringVersion: ATTENTION_SCORING_VERSION,
    focusMetricVersion: FOCUS_METRIC_V1.version,
    actualSeconds: 620,
    measuredSeconds: 600,
    scoreSum: 48_000,
    sessionEfficiency: 80,
    deepFocusMinutes: 10,
    focusedSeconds: 580,
  }
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
})

describe('focus ledger persistence', () => {
  it('adds and removes the exact saved session contribution', () => {
    const saved = saveSession(validSession())
    expect(loadFocusLedger().days['2026-08-17'].sessions[saved.id]).toBeTruthy()
    deleteSession(saved.id)
    expect(loadSessions()).toEqual([])
    expect(loadFocusLedger().days).toEqual({})
  })

  it('clears session history and its derived ledger together', () => {
    saveSession(validSession())
    clearAllSessions()
    expect(loadSessions()).toEqual([])
    expect(localStorage.getItem(FOCUS_LEDGER_KEY)).toBeNull()
  })

  it('backfills a session an older build saved without ever writing to the ledger', () => {
    // Simulates a build older than the ledger itself: the raw session made it
    // to eudaimonia_sessions (e.g. via a direct write, standing in for a pre-
    // ledger saveSession), but focusMetricVersion/sessionEfficiency and any
    // ledger entry were never produced.
    const raw = {
      id: 'pre-ledger-build',
      startedAt: new Date(2026, 7, 17, 9).getTime(),
      attentionScoringVersion: ATTENTION_SCORING_VERSION,
      actualSeconds: 620,
      measuredSeconds: 600,
      scoreSum: 48_000,
      focusPhases: { seconds: { arrival: 0, ramp: 0, lock_in: 600, fade: 0, recovery: 0, drift: 0 } },
    }
    localStorage.setItem('eudaimonia_sessions', JSON.stringify([raw]))
    expect(loadFocusLedger().days).toEqual({})

    const ledger = backfillFocusLedgerFromSessions()
    expect(ledger.days['2026-08-17'].sessions['pre-ledger-build']).toBeTruthy()
    expect(loadFocusLedger().days['2026-08-17'].sessions['pre-ledger-build']).toBeTruthy()
  })

  it('persists a recoverable legacy timeline with explicit migration provenance', () => {
    const measuredSeconds = 600
    const legacy = {
      id: 'legacy-timeline',
      startedAt: new Date(2026, 7, 17, 9).getTime(),
      actualSeconds: 620,
      timeline: Array.from({ length: 120 }, (_, index) => ({
        second: 25 + index * 5,
        score: 86,
        focused: true,
      })),
      focusPhases: {
        seconds: { arrival: 0, ramp: 0, lock_in: measuredSeconds, fade: 0, recovery: 0, drift: 0 },
      },
    }
    localStorage.setItem('eudaimonia_sessions', JSON.stringify([legacy]))

    backfillFocusLedgerFromSessions()

    expect(loadSessions()[0]).toMatchObject({
      attentionScoringVersion: ATTENTION_SCORING_VERSION,
      measuredSeconds,
      sessionEfficiency: 86,
      focusMeasurementSource: 'legacy_timeline_v1',
      focusMetricRejection: null,
    })
    expect(loadFocusLedger().days['2026-08-17'].sessions['legacy-timeline']).toMatchObject({
      source: 'legacy_timeline_v1',
      measuredSeconds,
    })
  })

  it('keeps daily contributions after detailed history reaches its 100-session cap', () => {
    for (let index = 0; index < 101; index += 1) {
      saveSession(validSession(new Date(2026, 7, 17 + index, 9).getTime()))
    }
    const contributionCount = Object.values(loadFocusLedger().days)
      .reduce((sum, day) => sum + Object.keys(day.sessions).length, 0)
    expect(loadSessions()).toHaveLength(100)
    expect(contributionCount).toBe(101)
  })
})
