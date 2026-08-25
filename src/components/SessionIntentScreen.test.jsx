import React from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import SessionIntentScreen from './SessionIntentScreen'

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
}

function renderIntent(overrides = {}) {
  const noop = () => {}
  return renderToString(React.createElement(SessionIntentScreen, {
    task: '', setTask: noop,
    goal: '', setGoal: noop,
    duration: 30, setDuration: noop,
    energyLevel: 'medium', setEnergyLevel: noop,
    tags: [], setTags: noop,
    onStart: noop,
    ...overrides,
  })).replaceAll('<!-- -->', '')
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
})

describe('SessionIntentScreen', () => {
  it('is an intent briefing and does not display a focus metric', () => {
    const html = renderIntent()
    expect(html).toContain('Session Planning')
    expect(html).toContain('Definition of done')
    expect(html).not.toContain('Focus Score')
    expect(html).toContain('disabled=""')
  })

  it('reuses honest fields from recent session history', () => {
    localStorage.setItem('eudaimonia_sessions', JSON.stringify([{
      task: 'Draft essay',
      goal: 'Write 800 words',
      duration: 60,
      tags: ['Writing'],
      energyLevel: 'fresh',
    }]))
    const html = renderIntent({ task: 'Current task' })
    expect(html).toContain('Draft essay')
    expect(html).toContain('Write 800 words')
    expect(html).toContain('60 min')
    expect(html).toContain('<button class="session-intent-start" type="button">')
  })
})
