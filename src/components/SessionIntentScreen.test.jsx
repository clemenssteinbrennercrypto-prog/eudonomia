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

const CONNECTED = { checked: true, connected: true, helperInstalled: true }

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

  it('connects the workspace explanation to its clean select control', () => {
    const html = renderIntent({
      workspaces: [{ id: 'desk', name: 'Desk' }],
      activeWorkspaceId: 'desk',
    })

    expect(html).toContain('class="session-select-control"')
    expect(html).toContain('id="session-workspace-help"')
    expect(html).toContain('aria-describedby="session-workspace-help"')
  })

  it('names the active setup and starts a protected session only when rules can be enforced', () => {
    const html = renderIntent({
      task: 'Current task',
      protectionEnabled: true,
      protectionSetup: { name: 'Writing', distractionApps: ['Slack'], distractionDomains: [], strictMode: false },
      nativeStatus: CONNECTED,
      onEditProtection: () => {},
    })

    expect(html).toContain('Writing · protected')
    expect(html).toContain('1 distraction unavailable during this session')
    expect(html).toContain('Start protected session')
  })

  describe('protection claims follow the Companion', () => {
    const writing = { name: 'Writing', distractionApps: ['Slack'], distractionDomains: [], strictMode: false }
    const render = overrides => renderIntent({ task: 'Current task', protectionEnabled: true, protectionSetup: writing, onEditProtection: () => {}, ...overrides })

    it('never claims protection before the Companion has been checked', () => {
      const html = render({ nativeStatus: { checked: false, connected: false, helperInstalled: false } })
      expect(html).toContain('Writing · checking Companion')
      expect(html).not.toContain('protected')
      expect(html).toContain('Start focus session')
    })

    it('reports a missing Companion instead of a protected session', () => {
      const html = render({ nativeStatus: { checked: true, connected: false, helperInstalled: false } })
      expect(html).toContain('Writing · Companion not connected')
      expect(html).toContain('nothing is enforced until the Companion app is running')
      expect(html).not.toContain('Start protected session')
      expect(html).toContain('>Edit<')
    })

    it('requires the website helper only when websites are blocked', () => {
      const websites = { ...writing, distractionApps: ['YouTube'], distractionDomains: ['youtube.com'] }
      const withoutHelper = render({ protectionSetup: websites, nativeStatus: { checked: true, connected: true, helperInstalled: false } })
      expect(withoutHelper).toContain('Writing · website helper required')
      expect(withoutHelper).not.toContain('Start protected session')

      const appsOnly = render({ nativeStatus: { checked: true, connected: true, helperInstalled: false } })
      expect(appsOnly).toContain('Start protected session')
    })

    it('does not claim any protection when the Companion lacks System Events access', () => {
      const denied = { ...CONNECTED, missingPermissions: [{ name: 'System Events', scope: 'system' }] }
      const html = render({ nativeStatus: denied })
      expect(html).toContain('Writing · permission required')
      expect(html).toContain('Nothing is enforced until the Companion has Automation access for System Events.')
      expect(html).not.toContain('Start protected session')

      const websiteOnly = render({ protectionSetup: { ...writing, distractionApps: ['reddit.com'], distractionDomains: ['reddit.com'] }, nativeStatus: denied })
      expect(websiteOnly).not.toContain('Start protected session')
    })

    it('limits a browser permission gap to website protection', () => {
      const denied = { ...CONNECTED, missingPermissions: [{ name: 'Safari', scope: 'browser' }] }
      expect(render({ nativeStatus: denied })).toContain('Start protected session')

      const websiteOnly = render({ protectionSetup: { ...writing, distractionApps: ['reddit.com'], distractionDomains: ['reddit.com'] }, nativeStatus: denied })
      expect(websiteOnly).toContain('Writing · permission required')
      expect(websiteOnly).toContain('Blocked websites can&#x27;t be closed in Safari until the Companion has Automation access.')
      expect(websiteOnly).not.toContain('Start protected session')
    })

    it('treats strict mode without a blocklist as protection once the Companion is connected', () => {
      const html = render({ protectionSetup: { name: 'Deep', distractionApps: [], distractionDomains: [], strictMode: true }, nativeStatus: CONNECTED })
      expect(html).toContain('Deep · protected')
      expect(html).toContain('Strict protection · unlisted apps hidden · 0 selected distractions unavailable')
    })

    it('does not call an allowed-only setup protected, even with the Companion connected', () => {
      const html = render({ protectionSetup: { name: 'Tools', focusApps: ['VS Code'], distractionApps: [], distractionDomains: [], strictMode: false }, nativeStatus: CONNECTED })
      expect(html).toContain('Not configured')
      expect(html).toContain('>Set up<')
      expect(html).toContain('Start focus session')
    })

    it('says protection is off whatever the Companion reports', () => {
      const html = render({ protectionEnabled: false, nativeStatus: CONNECTED })
      expect(html).toContain('Protection off')
      expect(html).toContain('Start focus session')
    })
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
