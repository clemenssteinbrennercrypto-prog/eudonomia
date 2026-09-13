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
    expect(html).toContain('Definition of plan')
    expect(html).toContain('1000 words')
    expect(html).toContain('aria-labelledby="session-plan-field-label"')
    expect(html).not.toContain('Focus Score')
    expect(html).toContain('disabled=""')
  })

  it('offers custom and unlimited sessions with an unmistakable start action', () => {
    const html = renderIntent({ task: 'Current task', duration: null })
    expect(html).toContain('Custom')
    expect(html).toContain('No limit')
    expect(html).toContain('Start focus session')
    expect(html).toContain('▶')
  })

  it('names the active setup and starts a protected session only when rules can be enforced', () => {
    const html = renderIntent({
      task: 'Current task',
      protectionEnabled: true,
      protectionSetup: { name: 'Writing', distractionApps: ['Reddit'], strictMode: false },
      onEditProtection: () => {},
    })

    expect(html).toContain('Writing · protected')
    expect(html).toContain('1 distraction unavailable during this session')
    expect(html).toContain('Start protected session')
  })

  it('offers direct setup selection when more than one protection setup exists', () => {
    const html = renderIntent({
      task: 'Current task',
      protectionEnabled: true,
      protectionSetup: { id: 'writing', name: 'Writing', distractionApps: ['Reddit'] },
      protectionSetups: [
        { id: 'writing', name: 'Writing' },
        { id: 'study', name: 'Study' },
      ],
      onProtectionSetupChange: () => {},
    })

    expect(html).toContain('aria-label="Protection setup"')
    expect(html).toContain('<option value="study">Study</option>')
  })

  it('reuses honest fields from recent session history', () => {
    // History arrives as a prop — App owns loading it from the repository.
    const html = renderIntent({
      task: 'Current task',
      recentSessions: [{
        task: 'Draft essay',
        goal: 'Write 800 words',
        duration: 60,
        tags: ['Writing'],
        energyLevel: 'fresh',
      }],
    })
    expect(html).toContain('Draft essay')
    expect(html).toContain('Write 800 words')
    expect(html).toContain('60 min')
    expect(html).toContain('<button class="session-intent-start" type="button">')
  })
})
