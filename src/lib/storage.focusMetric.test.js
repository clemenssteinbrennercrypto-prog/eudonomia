import { beforeEach, describe, expect, it } from 'vitest'
import {
  FOCUS_LEDGER_KEY,
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
