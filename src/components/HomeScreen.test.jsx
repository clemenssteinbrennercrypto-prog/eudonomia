import React from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import HomeScreen from './HomeScreen'
import { saveSession } from '../lib/storage'
import { ATTENTION_SCORING_VERSION, FOCUS_METRIC_V1 } from '../lib/focusMetric'

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

function renderHome() {
  const noop = () => {}
  return renderToString(React.createElement(HomeScreen, {
    task: '', setTask: noop,
    duration: 30, setDuration: noop,
    goal: '', setGoal: noop,
    energyLevel: 'medium', setEnergyLevel: noop,
    tags: [], setTags: noop,
    devices: [],
    focusModeEnabled: true, setFocusModeEnabled: noop,
    onStart: noop, onShowHistory: noop, onShowSetup: noop, onShowFocusApps: noop,
  })).replaceAll('<!-- -->', '')
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
  globalThis.window = { __TAURI__: null }
})

describe('HomeScreen Focus Score', () => {
  it('shows the honest empty state before the first eligible v1 session', () => {
    const html = renderHome()
    expect(html).toContain('Today&#x27;s Focus Score')
    expect(html).toContain('Starts after 5 measured minutes')
  })

  it('shows today’s score and its three drivers', () => {
    const startedAt = Date.now() - 122 * 60 * 1000
    saveSession({
      startedAt,
      attentionScoringVersion: ATTENTION_SCORING_VERSION,
      focusMetricVersion: FOCUS_METRIC_V1.version,
      actualSeconds: 7220,
      measuredSeconds: 7200,
      scoreSum: 684_000,
      sessionEfficiency: 95,
      deepFocusMinutes: 120,
      focusedSeconds: 7000,
      scoreMeasured: true,
    })
    const html = renderHome()
    expect(html).toContain('86')
    expect(html).toContain('Efficiency')
    expect(html).toContain('Deep focus')
    expect(html).toContain('120 / 120 min')
  })
})
