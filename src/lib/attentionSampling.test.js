import { describe, expect, it } from 'vitest'
import {
  ATTENTION_ACCUMULATION_VERSION,
  DEEP_FOCUS_TIME_VERSION,
  FLOW_ENTRY_MS,
  FLOW_INTERRUPTION_HOLD_MS,
  advanceFlowGate,
  accumulateMeasuredSpan,
  measuredSpanSeconds,
} from './attentionSampling'

describe('Deep Focus flow gate', () => {
  it('enters only after 90 seconds of qualified focus', () => {
    const almost = advanceFlowGate({}, { qualified: true, sampleMs: FLOW_ENTRY_MS - 100 })
    expect(almost).toMatchObject({ qualifiedMs: FLOW_ENTRY_MS - 100, inFlow: false })
    expect(advanceFlowGate(almost, { qualified: true, sampleMs: 100 }))
      .toMatchObject({ qualifiedMs: FLOW_ENTRY_MS, interruptionMs: 0, inFlow: true })
  })

  it('survives a brief noisy frame without counting it or erasing the warm-up', () => {
    const almost = { qualifiedMs: FLOW_ENTRY_MS - 100, interruptionMs: 0, inFlow: false }
    const noise = advanceFlowGate(almost, { qualified: false, sampleMs: 100 })
    expect(noise).toEqual({ qualifiedMs: FLOW_ENTRY_MS - 100, interruptionMs: 100, inFlow: false })
    expect(advanceFlowGate(noise, { qualified: true, sampleMs: 100 }))
      .toEqual({ qualifiedMs: FLOW_ENTRY_MS, interruptionMs: 0, inFlow: true })
  })

  it('exits and erases the warm-up after a sustained interruption', () => {
    const active = { qualifiedMs: FLOW_ENTRY_MS, interruptionMs: 0, inFlow: true }
    const brief = advanceFlowGate(active, { qualified: false, sampleMs: FLOW_INTERRUPTION_HOLD_MS - 100 })
    expect(brief.inFlow).toBe(true)
    expect(advanceFlowGate(brief, { qualified: false, sampleMs: 100 }))
      .toEqual({ qualifiedMs: 0, interruptionMs: FLOW_INTERRUPTION_HOLD_MS, inFlow: false })
  })
})

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
    flowSeconds: 20,
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
      flowSeconds: 20,
      currentStreak: 241,
      longestStreak: 241,
      goodStreakSeconds: 241,
      currentPhase: 'lock_in',
      phaseTransition: { second: 241, from: 'ramp', to: 'lock_in' },
      timelineSample: { second: 241, score: 80, focused: true, phase: 'lock_in' },
    })
    expect(next.phaseSeconds.lock_in).toBe(2)
  })

  it('counts deep focus only inside the strict Flow state and above its threshold', () => {
    const inFlow = accumulateMeasuredSpan(current, {
      sampleSeconds: 2,
      elapsedSecs: 241,
      score: 80,
      msSinceDistraction: Infinity,
      inFlow: true,
      flowQualified: true,
    })
    const belowFlowThreshold = accumulateMeasuredSpan(current, {
      sampleSeconds: 2,
      elapsedSecs: 241,
      score: 71,
      msSinceDistraction: Infinity,
      inFlow: true,
      flowQualified: true,
    })
    const noisyFrame = accumulateMeasuredSpan(current, {
      sampleSeconds: 2,
      elapsedSecs: 241,
      score: 80,
      msSinceDistraction: Infinity,
      inFlow: true,
      flowQualified: false,
    })
    expect(DEEP_FOCUS_TIME_VERSION).toBe(1)
    expect(inFlow.flowSeconds).toBe(22)
    expect(belowFlowThreshold.flowSeconds).toBe(20)
    expect(noisyFrame.flowSeconds).toBe(20)
    expect(noisyFrame.timelineSample).toMatchObject({ inFlow: true, deepFocused: false })
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
