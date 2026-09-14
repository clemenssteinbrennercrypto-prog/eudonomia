/** @vitest-environment jsdom */
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FocusAppsScreen from './FocusAppsScreen'
import { PROTECTION_SETUPS_KEY, loadProtectionSetups } from '../lib/storage'
import { normalizeProtectionState } from '../lib/protectionSetups'

const companion = vi.hoisted(() => ({ debug: null }))

vi.mock('../lib/nativeCompanion', () => ({
  fetchCompanionDebug: vi.fn(async () => companion.debug),
  fetchNativeCameraStatus: vi.fn(async () => null),
  installCompanionHelper: vi.fn(async () => ({ ok: true })),
  listenNativeCameraLandmarks: vi.fn(async () => () => {}),
  listenNativeCameraStatus: vi.fn(async () => () => {}),
  pushCompanionSession: vi.fn(async () => true),
  startNativeCameraPrototype: vi.fn(async () => null),
  stopNativeCameraPrototype: vi.fn(async () => null),
  setCloudApiKey: vi.fn(async () => true),
  deleteCloudApiKey: vi.fn(async () => true),
  hasCloudApiKey: vi.fn(async () => false),
}))

vi.mock('../lib/activityReceiver', () => ({
  getLastActivity: () => null,
  isActivityConnected: () => false,
  startActivityUpdates: () => {},
  stopActivityUpdates: () => {},
}))

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

const library = () => normalizeProtectionState({
  activeSetupId: 'default',
  setups: [
    { id: 'default', name: 'Deep Work', distractionApps: ['YouTube'] },
    { id: 'writing', name: 'Writing', focusApps: ['Pages'], distractionApps: ['Slack'] },
  ],
})

async function renderScreen(props = {}) {
  const onProtectionStateChange = vi.fn()
  const onBack = vi.fn()
  const result = render(React.createElement(FocusAppsScreen, {
    onBack,
    focusModeEnabled: true,
    setFocusModeEnabled: () => {},
    protectionState: library(),
    onProtectionStateChange,
    ...props,
  }))
  await act(async () => {})
  return { ...result, onProtectionStateChange, onBack }
}

const saveStatus = () => screen.getByText(/^(All changes saved|Unsaved changes|Name every setup before saving)$/)
const setupButton = name => within(screen.getByRole('complementary', { name: 'Protection setups' })).getByRole('button', { name: new RegExp(`^${name}`) })
const unavailableSection = () => screen.getByRole('heading', { name: 'Unavailable during focus' }).closest('section')

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
  companion.debug = { helperInstalled: true }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FocusAppsScreen setup library', () => {
  it('is clean again after adding and removing the same distraction', async () => {
    await renderScreen()
    expect(saveStatus()).toHaveTextContent('All changes saved')

    fireEvent.click(within(unavailableSection()).getByRole('button', { name: '+ Reddit' }))
    expect(saveStatus()).toHaveTextContent('Unsaved changes')

    fireEvent.click(within(unavailableSection()).getByRole('button', { name: 'Remove Reddit' }))
    expect(saveStatus()).toHaveTextContent('All changes saved')
    expect(screen.getByRole('button', { name: 'Save setup' })).toBeDisabled()
  })

  it('browses another setup without a dirty state or switching the session setup', async () => {
    const { onBack } = await renderScreen()

    fireEvent.click(setupButton('Writing'))
    expect(screen.getByRole('textbox', { name: 'Setup name' })).toHaveValue('Writing')
    expect(saveStatus()).toHaveTextContent('All changes saved')
    expect(screen.getByRole('button', { name: 'Use for sessions' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('switches the session setup only through the explicit action', async () => {
    const { onProtectionStateChange } = await renderScreen()

    fireEvent.click(setupButton('Writing'))
    fireEvent.click(screen.getByRole('button', { name: 'Use for sessions' }))
    expect(saveStatus()).toHaveTextContent('Unsaved changes')
    expect(screen.getByText('Used for sessions', { selector: '.protection-session-badge' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save setup' }))
    expect(onProtectionStateChange).toHaveBeenCalledWith(expect.objectContaining({ activeSetupId: 'writing' }))
    expect(loadProtectionSetups().activeSetupId).toBe('writing')
  })

  it('opens a new setup for editing without making it the session setup', async () => {
    await renderScreen()

    fireEvent.click(screen.getByRole('button', { name: '+ New setup' }))
    expect(screen.getByRole('textbox', { name: 'Setup name' })).toHaveValue('Focus setup 1')
    fireEvent.click(screen.getByRole('button', { name: 'Save setup' }))

    const saved = JSON.parse(localStorage.getItem(PROTECTION_SETUPS_KEY))
    expect(saved.activeSetupId).toBe('default')
    expect(saved.setups.map(setup => setup.name)).toEqual(['Deep Work', 'Writing', 'Focus setup 1'])
  })

  it('blocks saving a blank setup name instead of renaming it', async () => {
    const { onBack } = await renderScreen()
    const nameInput = screen.getByRole('textbox', { name: 'Setup name' })

    fireEvent.change(nameInput, { target: { value: '   ' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Give this setup a name.')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(saveStatus()).toHaveTextContent('Name every setup before saving')
    expect(screen.getByRole('button', { name: 'Save setup' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save & leave' }))
    expect(onBack).not.toHaveBeenCalled()
    expect(localStorage.getItem(PROTECTION_SETUPS_KEY)).toBeNull()
  })

  it('keeps clearing a generated name an unsaved change', async () => {
    const saved = normalizeProtectionState({
      activeSetupId: 'default',
      setups: [{ id: 'default', name: 'Deep Work', distractionApps: ['YouTube'] }, { id: 'new', name: 'Focus setup 1' }],
    })
    const { onBack } = await renderScreen({ protectionState: saved })

    fireEvent.click(setupButton('Focus setup 1'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Setup name' }), { target: { value: '' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Give this setup a name.')
    expect(saveStatus()).toHaveTextContent('Name every setup before saving')

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).not.toHaveBeenCalled()
    expect(screen.getByText('Unsaved changes', { selector: '.protection-leave-actions span' })).toBeInTheDocument()
  })

  it('blocks saving a duplicate name and points back to the offending setup', async () => {
    const { onBack } = await renderScreen()

    fireEvent.click(setupButton('Writing'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Setup name' }), { target: { value: 'deep work' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Another setup already uses this name.')
    expect(screen.getByRole('button', { name: 'Save setup' })).toBeDisabled()

    fireEvent.click(setupButton('Deep Work'))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save & leave' }))
    expect(onBack).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Setup name' })).toHaveValue('Deep Work')
    expect(screen.getByRole('alert')).toHaveTextContent('Another setup already uses this name.')
  })

  it('deleting the edited setup keeps the session setup valid', async () => {
    await renderScreen()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete setup' }))
    expect(screen.getByRole('textbox', { name: 'Setup name' })).toHaveValue('Writing')
    expect(screen.getByText('Used for sessions', { selector: '.protection-session-badge' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })
})

describe('FocusAppsScreen readiness', () => {
  it('does not say ready while the Companion is unreachable', async () => {
    companion.debug = null
    await renderScreen()

    expect(screen.getByText('Companion not connected')).toBeInTheDocument()
    expect(screen.queryByText('Ready for focus')).toBeNull()
  })

  it('asks for System Events access before claiming app protection', async () => {
    companion.debug = { helperInstalled: true, permissionMissing: 'System Events' }
    await renderScreen()

    fireEvent.click(setupButton('Writing'))
    const banner = within(document.querySelector('.protection-readiness'))
    expect(banner.getByText('Automation permission required')).toBeInTheDocument()
    expect(banner.getByText(/Automation access for System Events in System Settings so these rules can be enforced/)).toBeInTheDocument()
    expect(screen.queryByText('Ready for focus')).toBeNull()
  })

  it('keeps a browser permission gap scoped to setups that block websites', async () => {
    companion.debug = { helperInstalled: true, permissionMissing: 'Safari', lastActivity: { app: 'Safari', url: null, ts: 1 } }
    await renderScreen()

    const banner = () => within(document.querySelector('.protection-readiness'))
    expect(banner().getByText(/Automation access for Safari in System Settings so blocked websites can be closed there/)).toBeInTheDocument()

    fireEvent.click(setupButton('Writing'))
    expect(banner().getByText('Ready for focus')).toBeInTheDocument()
  })

  it('asks for the website helper before claiming website protection', async () => {
    companion.debug = { helperInstalled: false }
    await renderScreen()
    expect(screen.getByText('Website helper required')).toBeInTheDocument()

    fireEvent.click(setupButton('Writing'))
    expect(screen.getByText('Ready for focus')).toBeInTheDocument()
  })

  it('reports ready once the Companion confirms it can enforce the rules', async () => {
    await renderScreen()
    expect(screen.getByText('Ready for focus')).toBeInTheDocument()
  })
})
