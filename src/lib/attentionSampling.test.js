import { describe, expect, it } from 'vitest'
import {
  ATTENTION_ACCUMULATION_VERSION,
  accumulateMeasuredSpan,
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

describe('shared measured-span accumulation', () => {
  const current = {
    measuredSeconds: 239,
    scoreSum: 19_120,
    focusedSeconds: 239,
    preDriftSeconds: 0,
    currentStreak: 239,
    longestStreak: 239,
    goodStreakSeconds: 239,
    currentPhase: 'ramp',
    phaseSeconds: { arrival: 0, ramp: 239, lock_in: 0, fade: 0, recovery: 0, drift: 0 },
    lastTimelineBucket: 47,
  }

  it('updates phase, streaks, totals, and timeline in one transition', () => {
    const next = accumulateMeasuredSpan(current, {
      sampleSeconds: 2,
      elapsedSecs: 241,
      score: 80,
      msSinceDistraction: Infinity,
      preDriftActive: false,
      inFlow: false,
      timelineIntervalSeconds: 5,
      activity: { kind: 'aligned' },
    })
    expect(next).toMatchObject({
      measuredSeconds: 241,
      scoreSum: 19_280,
      focusedSeconds: 241,
      currentStreak: 241,
      longestStreak: 241,
      goodStreakSeconds: 241,
      currentPhase: 'lock_in',
      phaseTransition: { second: 241, from: 'ramp', to: 'lock_in' },
      timelineSample: { second: 241, score: 80, focused: true, phase: 'lock_in' },
    })
    expect(next.phaseSeconds.lock_in).toBe(2)
  })

  it('forces a final timeline sample even inside the current snapshot bucket', () => {
    const next = accumulateMeasuredSpan({ ...current, lastTimelineBucket: 12 }, {
      sampleSeconds: 0.5,
      elapsedSecs: 61,
      score: 80,
      msSinceDistraction: Infinity,
      forceTimelineSample: true,
    })
    expect(next.timelineSample).toMatchObject({ second: 61, score: 80 })
  })

})
