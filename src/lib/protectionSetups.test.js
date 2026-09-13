import { describe, expect, it } from 'vitest'
import {
  activateProtectionSetup,
  createProtectionSetup,
  getActiveProtectionSetup,
  normalizeProtectionState,
  removeProtectionSetup,
  updateActiveProtectionSetup,
} from './protectionSetups'

describe('protection setups', () => {
  it('migrates the legacy rules into one active setup without changing their meaning', () => {
    const state = normalizeProtectionState(null, {
      focusApps: ['VS Code', 'VS Code'],
      distractionApps: ['YouTube', 'reddit.com'],
      strictMode: true,
    })

    expect(state.activeSetupId).toBe('default')
    expect(state.setups).toHaveLength(1)
    expect(state.setups[0]).toMatchObject({
      name: 'Deep Work',
      focusApps: ['VS Code'],
      distractionApps: ['YouTube', 'reddit.com'],
      strictMode: true,
    })
    expect(state.setups[0].distractionDomains).toContain('youtube.com')
    expect(state.setups[0].distractionDomains).toContain('reddit.com')
  })

  it('keeps rules isolated when switching between setups', () => {
    let state = normalizeProtectionState(null, { distractionApps: ['Reddit'] })
    state = createProtectionSetup(state, { name: 'Writing', idSeed: 10 })
    state = updateActiveProtectionSetup(state, { focusApps: ['Pages'], strictMode: true })
    const writingId = state.activeSetupId
    state = activateProtectionSetup(state, 'default')

    expect(getActiveProtectionSetup(state).distractionApps).toEqual(['Reddit'])
    expect(getActiveProtectionSetup(state).focusApps).toEqual([])
    expect(state.setups.find(setup => setup.id === writingId)).toMatchObject({
      focusApps: ['Pages'],
      strictMode: true,
    })
  })

  it('can duplicate a setup while keeping future edits independent', () => {
    let state = normalizeProtectionState(null, { focusApps: ['Figma'], distractionApps: ['YouTube'] })
    state = createProtectionSetup(state, { copyActive: true, idSeed: 11 })
    state = updateActiveProtectionSetup(state, { distractionApps: ['Instagram'] })

    expect(state.setups[0].distractionApps).toEqual(['YouTube'])
    expect(getActiveProtectionSetup(state).distractionApps).toEqual(['Instagram'])
    expect(getActiveProtectionSetup(state).focusApps).toEqual(['Figma'])
  })

  it('never deletes the final setup and selects a neighbour after deleting the active one', () => {
    let state = normalizeProtectionState(null)
    expect(removeProtectionSetup(state, 'default').setups).toHaveLength(1)

    state = createProtectionSetup(state, { name: 'Study', idSeed: 12 })
    const studyId = state.activeSetupId
    state = removeProtectionSetup(state, studyId)

    expect(state.setups).toHaveLength(1)
    expect(state.activeSetupId).toBe('default')
  })

  it('refuses a missing active id rather than returning mixed or absent rules', () => {
    const state = normalizeProtectionState({
      activeSetupId: 'missing',
      setups: [{ id: 'writing', name: 'Writing', focusApps: ['Pages'] }],
    })

    expect(state.activeSetupId).toBe('writing')
    expect(getActiveProtectionSetup(state).focusApps).toEqual(['Pages'])
  })
})
