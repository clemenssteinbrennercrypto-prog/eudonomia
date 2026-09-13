import { beforeEach, describe, expect, it } from 'vitest'
import {
  FOCUS_APPS_KEY,
  PROTECTION_SETUPS_KEY,
  loadFocusAppsConfig,
  loadProtectionSetups,
  loadStrictMode,
  saveFocusAppsConfig,
  saveProtectionSetups,
  saveStrictMode,
} from './storage'
import { activateProtectionSetup, createProtectionSetup, getActiveProtectionSetup } from './protectionSetups'

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
  clear() { this.values.clear() }
}

describe('protection setup storage', () => {
  beforeEach(() => { globalThis.localStorage = new MemoryStorage() })

  it('loads the pre-setup keys as one legacy-compatible setup', () => {
    localStorage.setItem(FOCUS_APPS_KEY, JSON.stringify({
      focusApps: ['VS Code'],
      distractionApps: ['YouTube'],
    }))
    localStorage.setItem('eudaimonia_strict_mode', 'true')

    const state = loadProtectionSetups()
    expect(state.setups).toHaveLength(1)
    expect(getActiveProtectionSetup(state)).toMatchObject({
      focusApps: ['VS Code'],
      distractionApps: ['YouTube'],
      strictMode: true,
    })
  })

  it('exposes only the active setup to existing session consumers', () => {
    let state = loadProtectionSetups()
    state = createProtectionSetup(state, { name: 'Writing', idSeed: 20 })
    state = {
      ...state,
      setups: state.setups.map(setup => setup.id === state.activeSetupId
        ? { ...setup, focusApps: ['Pages'], distractionApps: ['Reddit'], strictMode: true }
        : setup),
    }
    saveProtectionSetups(state)

    expect(loadFocusAppsConfig()).toMatchObject({
      name: 'Writing',
      focusApps: ['Pages'],
      distractionApps: ['Reddit'],
      strictMode: true,
    })
    expect(loadStrictMode()).toBe(true)
    expect(JSON.parse(localStorage.getItem(FOCUS_APPS_KEY))).toMatchObject({
      focusApps: ['Pages'],
      distractionApps: ['Reddit'],
    })
  })

  it('keeps compatibility saves inside the active setup instead of overwriting the library', () => {
    let state = createProtectionSetup(loadProtectionSetups(), { name: 'Study', idSeed: 21 })
    saveProtectionSetups(state)
    saveFocusAppsConfig({ focusApps: ['Preview'], distractionApps: ['Netflix'] })
    saveStrictMode(true)

    state = JSON.parse(localStorage.getItem(PROTECTION_SETUPS_KEY))
    expect(state.setups).toHaveLength(2)
    expect(getActiveProtectionSetup(state)).toMatchObject({
      name: 'Study',
      focusApps: ['Preview'],
      distractionApps: ['Netflix'],
      strictMode: true,
    })
    expect(state.setups[0].focusApps).toEqual([])
  })

  it('switching the session setup, as the start screen does, changes what sessions enforce', () => {
    let state = createProtectionSetup(loadProtectionSetups(), { name: 'Strict study', idSeed: 22 })
    state = {
      ...state,
      setups: state.setups.map(setup => setup.id === state.activeSetupId
        ? { ...setup, focusApps: ['Preview'], strictMode: true }
        : { ...setup, distractionApps: ['YouTube'] }),
    }
    const studyId = state.activeSetupId
    saveProtectionSetups(activateProtectionSetup(state, 'default'))

    expect(loadFocusAppsConfig()).toMatchObject({ id: 'default', distractionApps: ['YouTube'], strictMode: false })
    expect(loadStrictMode()).toBe(false)
    expect(localStorage.getItem('eudaimonia_strict_mode')).toBe('false')

    saveProtectionSetups(activateProtectionSetup(loadProtectionSetups(), studyId))
    expect(loadFocusAppsConfig()).toMatchObject({ id: studyId, focusApps: ['Preview'], distractionApps: [], strictMode: true })
    expect(loadStrictMode()).toBe(true)
    expect(JSON.parse(localStorage.getItem(FOCUS_APPS_KEY))).toMatchObject({ focusApps: ['Preview'], distractionApps: [] })
  })

  it('ignores an unknown setup id instead of clearing the enforced rules', () => {
    saveFocusAppsConfig({ distractionApps: ['Reddit'] })
    saveProtectionSetups(activateProtectionSetup(loadProtectionSetups(), 'missing'))

    expect(loadFocusAppsConfig()).toMatchObject({ id: 'default', distractionApps: ['Reddit'] })
  })
})
