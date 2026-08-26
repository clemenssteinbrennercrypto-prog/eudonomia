import { describe, expect, it } from 'vitest'
import {
  blockingLeaseSeconds,
  durationFromSession,
  durationFromSetup,
  isCustomDuration,
  sessionTimerSeconds,
  shouldAutoEndSession,
  UNLIMITED_BLOCKING_LEASE_SECONDS,
} from './sessionDuration'

describe('unlimited session duration', () => {
  it('counts up and never auto-ends', () => {
    expect(sessionTimerSeconds(null, 45.8)).toBe(45)
    expect(shouldAutoEndSession(null, 0)).toBe(false)
  })

  it('keeps native protection alive with a bounded rolling lease', () => {
    expect(blockingLeaseSeconds(null, 0)).toBe(UNLIMITED_BLOCKING_LEASE_SECONDS)
  })

  it('preserves explicit unlimited values through setup and restart', () => {
    expect(durationFromSetup({ duration: null })).toBeNull()
    expect(durationFromSession({ plannedDuration: null })).toBeNull()
    expect(durationFromSetup({})).toBe(30)
    expect(durationFromSession({})).toBe(30)
  })

  it('identifies a reused custom duration so its editor stays visible', () => {
    expect(isCustomDuration(45, [15, 30, 60, 90])).toBe(true)
    expect(isCustomDuration(30, [15, 30, 60, 90])).toBe(false)
    expect(isCustomDuration(null, [15, 30, 60, 90])).toBe(false)
  })

  it('retains countdown and auto-end behavior for timed sessions', () => {
    expect(sessionTimerSeconds(30, 12.2)).toBe(1788)
    expect(shouldAutoEndSession(30, 0)).toBe(true)
    expect(blockingLeaseSeconds(30, 42)).toBe(42)
  })
})
