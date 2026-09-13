import { describe, expect, it } from 'vitest'
import {
  activateProtectionSetup,
  createProtectionSetup,
  firstProtectionSetupWithNameIssue,
  getActiveProtectionSetup,
  normalizeProtectionState,
  protectionDraftKey,
  protectionSetupNameIssue,
  removeProtectionSetup,
  updateActiveProtectionSetup,
  updateProtectionSetup,
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

  it('never renames a blank setup to the shared default name', () => {
    const state = normalizeProtectionState({
      activeSetupId: 'default',
      setups: [
        { id: 'default', name: 'Deep Work' },
        { id: 'writing', name: '   ' },
        { id: 'study', name: '' },
      ],
    })

    expect(state.setups.map(setup => setup.name)).toEqual(['Deep Work', 'Focus setup 1', 'Focus setup 2'])
  })

  it('does not generate a name that a later setup already uses', () => {
    const state = normalizeProtectionState({
      setups: [{ id: 'a', name: '' }, { id: 'b', name: 'Focus setup 1' }],
    })

    expect(state.setups.map(setup => setup.name)).toEqual(['Focus setup 2', 'Focus setup 1'])
  })

  it('keeps stored names distinguishable, case-insensitively and within the length limit', () => {
    const long = 'x'.repeat(48)
    const state = normalizeProtectionState({
      setups: [
        { id: 'a', name: 'Writing' },
        { id: 'b', name: ' writing ' },
        { id: 'c', name: long },
        { id: 'd', name: long },
      ],
    })

    expect(state.setups.map(setup => setup.name)).toEqual(['Writing', 'writing 2', long, `${'x'.repeat(46)} 2`])
    expect(state.setups.every(setup => setup.name.length <= 48)).toBe(true)
  })

  it('reports blank and duplicate names so the editor can block saving', () => {
    const setups = [
      { id: 'a', name: 'Writing' },
      { id: 'b', name: 'WRITING ' },
      { id: 'c', name: ' ' },
      { id: 'd', name: 'Study' },
    ]

    expect(protectionSetupNameIssue(setups, 'a')).toBe('duplicate')
    expect(protectionSetupNameIssue(setups, 'b')).toBe('duplicate')
    expect(protectionSetupNameIssue(setups, 'c')).toBe('blank')
    expect(protectionSetupNameIssue(setups, 'd')).toBeNull()
    expect(protectionSetupNameIssue(setups, 'missing')).toBeNull()
    expect(firstProtectionSetupWithNameIssue(setups)?.id).toBe('a')
    expect(firstProtectionSetupWithNameIssue([{ id: 'd', name: 'Study' }])).toBeNull()
  })

  it('can create or duplicate a setup without changing the session setup', () => {
    let state = normalizeProtectionState({
      activeSetupId: 'default',
      setups: [
        { id: 'default', name: 'Deep Work', distractionApps: ['YouTube'] },
        { id: 'writing', name: 'Writing', focusApps: ['Pages'], strictMode: true },
      ],
    })
    state = createProtectionSetup(state, { copyFromId: 'writing', activate: false, idSeed: 30 })

    expect(state.activeSetupId).toBe('default')
    expect(state.setups[2]).toMatchObject({ name: 'Writing copy', focusApps: ['Pages'], strictMode: true })

    state = createProtectionSetup(state, { copyFromId: 'writing', activate: false, idSeed: 31 })
    expect(state.setups[3].name).toBe('Writing copy 2')
  })

  it('updates a non-active setup by id without touching the session setup', () => {
    let state = normalizeProtectionState({
      activeSetupId: 'default',
      setups: [{ id: 'default', name: 'Deep Work' }, { id: 'writing', name: 'Writing' }],
    })
    state = updateProtectionSetup(state, 'writing', { distractionApps: ['Reddit'] })

    expect(state.activeSetupId).toBe('default')
    expect(getActiveProtectionSetup(state).distractionApps).toEqual([])
    expect(state.setups[1]).toMatchObject({ distractionApps: ['Reddit'], distractionDomains: ['reddit.com'] })
  })

  describe('draft comparison key', () => {
    const saved = normalizeProtectionState({
      activeSetupId: 'default',
      setups: [{ id: 'default', name: 'Deep Work', distractionApps: ['YouTube'] }, { id: 'new', name: 'Focus setup 1' }],
    })
    const withName = (id, name) => ({ ...saved, setups: saved.setups.map(setup => setup.id === id ? { ...setup, name } : setup) })

    it('treats clearing a generated name as a change', () => {
      expect(normalizeProtectionState(withName('new', '')).setups[1].name).toBe('Focus setup 1')
      expect(protectionDraftKey(withName('new', ''))).not.toBe(protectionDraftKey(saved))
      expect(protectionDraftKey(withName('new', '   '))).not.toBe(protectionDraftKey(saved))
    })

    it('treats a duplicate that normalization would suffix as a change', () => {
      expect(protectionDraftKey(withName('new', 'deep work'))).not.toBe(protectionDraftKey(saved))
    })

    it('ignores whitespace-only name edits and cleared derived domains', () => {
      expect(protectionDraftKey(withName('new', '  Focus   setup 1 '))).toBe(protectionDraftKey(saved))
      const cleared = { ...saved, setups: saved.setups.map(setup => ({ ...setup, distractionDomains: [] })) }
      expect(protectionDraftKey(cleared)).toBe(protectionDraftKey(saved))
    })

    it('handles a state without setups', () => {
      expect(protectionDraftKey(null)).toBe(protectionDraftKey(normalizeProtectionState(null)))
    })
  })
})
