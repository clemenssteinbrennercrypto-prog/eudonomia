import React from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import EndScreen from './EndScreen'

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
})

function render(sessionData) {
  return renderToString(React.createElement(EndScreen, {
    sessionData: { id: 'sess-1', ...sessionData },
    onRestart() {},
    onPrimaryAction() {},
  })).replaceAll('<!-- -->', '')
}

describe('EndScreen focus measurement', () => {
  it('shows absent distraction time when the camera measured nothing', () => {
    const html = render({
      actualSeconds: 3600,
      measuredSeconds: 0,
      focusedSeconds: 0,
      scoreMeasured: true,
      trackingFaulted: true,
    })
    expect(html).toContain('focus not measured')
    expect(html).toContain('distraction not measured')
  })

  it('keeps valid partial measurement when the session ends with a camera fault', () => {
    const html = render({
      actualSeconds: 3600,
      measuredSeconds: 1800,
      focusedSeconds: 1350,
      avgFocusScore: 75,
      scoreMeasured: true,
      trackingFaulted: true,
    })
    expect(html).toContain('75%')
    expect(html).toContain('8m')
    expect(html).toContain('time below threshold')
  })
})

describe('EndScreen post-session flow', () => {
  it('shows measured facts immediately, before any outcome is chosen', () => {
    const html = render({ actualSeconds: 1800, measuredSeconds: 1800, focusedSeconds: 1500, avgFocusScore: 83 })
    expect(html).toContain('83%')
    expect(html).toContain('Quick check-in')
    expect(html).not.toContain('Session read')
  })

  it('shows the session read only once an outcome has been recorded', () => {
    const html = render({
      actualSeconds: 1800, measuredSeconds: 1800, focusedSeconds: 1500, avgFocusScore: 83,
      goalOutcome: 'yes',
    })
    expect(html).toContain('Session read')
  })

  it('drops the removed report elements: rank badges, duration guess, copy/share', () => {
    const html = render({
      actualSeconds: 3600, measuredSeconds: 3600, focusedSeconds: 3200, avgFocusScore: 89,
      goalOutcome: 'yes', plannedDuration: 60,
    })
    expect(html).not.toContain('Elite')
    expect(html).not.toContain('New best')
    expect(html).not.toContain('Copy summary')
    expect(html).not.toContain('Share')
  })

  it('makes Continue to Analytics the primary action', () => {
    const html = render({ actualSeconds: 1800, measuredSeconds: 1800, focusedSeconds: 1500, avgFocusScore: 83 })
    expect(html).toContain('Continue to Analytics')
  })
})

// The AI verdict must stay disconnected from the post-session flow — this is a
// static check rather than a mock-and-assert, since there is genuinely no
// import to call in the first place once this passes.
describe('EndScreen has no path to a model call', () => {
  it('never imports the session verdict or model client modules', () => {
    const source = readFileSync(fileURLToPath(new URL('./EndScreen.jsx', import.meta.url)), 'utf8')
    expect(source).not.toMatch(/sessionVerdict|modelClient/)
  })
})
