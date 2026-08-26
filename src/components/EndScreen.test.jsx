import React from 'react'
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
    sessionData,
    onRestart() {},
    onShowHistory() {},
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
    expect(html).not.toContain('distraction not measured')
  })
})
