import { describe, expect, it } from 'vitest'
import {
  ATTENTION_ACCUMULATION_VERSION,
  measuredSpanSeconds,
} from './attentionSampling'

describe('wall-clock attention accumulation', () => {
  it('counts the real span when a background timer arrives late', () => {
    expect(measuredSpanSeconds({
      previousAt: 1_000,
      now: 3_000,
      lastDeliveredFrameAt: 2_950,
    })).toBe(2)
    expect(ATTENTION_ACCUMULATION_VERSION).toBe(2)
  })

  it('refuses a long callback gap instead of filling sleep with focus', () => {
    expect(measuredSpanSeconds({
      previousAt: 1_000,
      now: 11_000,
      lastDeliveredFrameAt: 10_950,
    })).toBe(0)
  })

  it('refuses a stale or not-yet-delivered camera frame', () => {
    expect(measuredSpanSeconds({
      previousAt: 1_000,
      now: 2_000,
      lastDeliveredFrameAt: 0,
    })).toBe(0)
    expect(measuredSpanSeconds({
      previousAt: 4_500,
      now: 5_000,
      lastDeliveredFrameAt: 1_500,
    })).toBe(0)
  })

  it('refuses malformed or reversed timestamps', () => {
    expect(measuredSpanSeconds({ previousAt: 2_000, now: 1_000, lastDeliveredFrameAt: 1_500 })).toBe(0)
    expect(measuredSpanSeconds({ previousAt: NaN, now: 2_000, lastDeliveredFrameAt: 1_500 })).toBe(0)
  })
})
