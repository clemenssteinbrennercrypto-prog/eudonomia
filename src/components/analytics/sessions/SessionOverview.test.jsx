import { describe, expect, it } from 'vitest'
import { buildAttentionTimes } from './SessionOverview'

describe('historical session attention time', () => {
  it('shows mutually exclusive durations and keeps breaks separate', () => {
    const entries = buildAttentionTimes({ pausedSeconds: 120 }, {
      actualSeconds: 1200,
      measuredSeconds: 1100,
      focusedSeconds: 700,
      deepFocusSeconds: 200,
    })

    expect(entries).toEqual([
      { id: 'high', label: 'High attention', seconds: 200 },
      { id: 'focused', label: 'Focused', seconds: 500 },
      { id: 'low', label: 'Low attention', seconds: 400 },
      { id: 'unmeasured', label: 'Not measured', seconds: 100 },
      { id: 'break', label: 'Break', seconds: 120 },
    ])
  })

  it('does not invent high-attention time for older sessions', () => {
    const entries = buildAttentionTimes({}, {
      actualSeconds: 600,
      measuredSeconds: 600,
      focusedSeconds: 420,
      deepFocusSeconds: null,
    })

    expect(entries).toEqual([
      { id: 'focused', label: 'Focused attention', seconds: 420 },
      { id: 'low', label: 'Low attention', seconds: 180 },
    ])
  })

  it('keeps missing camera time visible instead of counting it as low attention', () => {
    const entries = buildAttentionTimes({}, {
      actualSeconds: 600,
      measuredSeconds: null,
      focusedSeconds: null,
      deepFocusSeconds: null,
    })

    expect(entries).toEqual([
      { id: 'focused', label: 'Focused attention', seconds: 0 },
      { id: 'low', label: 'Low attention', seconds: 0 },
      { id: 'unmeasured', label: 'Not measured', seconds: 600 },
    ].filter(item => item.seconds > 0))
  })
})
