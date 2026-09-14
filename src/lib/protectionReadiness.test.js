import { describe, expect, it } from 'vitest'
import {
  UNCHECKED_COMPANION_STATUS,
  companionStatusFromDebug,
  getProtectionReadiness,
  missingPermissionsFromDebug,
  permissionTarget,
  protectionRuleCounts,
} from './protectionReadiness'
import { normalizeProtectionSetup } from './protectionSetups'

const CONNECTED = { checked: true, connected: true, helperInstalled: true, missingPermissions: [] }
const NO_HELPER = { ...CONNECTED, helperInstalled: false }
const blocklist = normalizeProtectionSetup({ distractionApps: ['Slack'] })
const websites = normalizeProtectionSetup({ distractionApps: ['YouTube'] })
const websiteOnly = normalizeProtectionSetup({ distractionDomains: ['reddit.com'] })
const strictOnly = normalizeProtectionSetup({ strictMode: true })
const allowedOnly = normalizeProtectionSetup({ focusApps: ['VS Code', 'notion.so'] })
const SYSTEM = { name: 'System Events', scope: 'system' }
const SAFARI = { name: 'Safari', scope: 'browser' }
const withMissing = (...missingPermissions) => ({ ...CONNECTED, missingPermissions })

describe('protection readiness', () => {
  it('walks every state boundary in order', () => {
    expect(getProtectionReadiness({ enabled: false, setup: blocklist, nativeStatus: CONNECTED }).state).toBe('off')
    expect(getProtectionReadiness({ enabled: true, setup: normalizeProtectionSetup({}), nativeStatus: CONNECTED }).state).toBe('empty')
    expect(getProtectionReadiness({ enabled: true, setup: blocklist, nativeStatus: UNCHECKED_COMPANION_STATUS }).state).toBe('checking')
    expect(getProtectionReadiness({ enabled: true, setup: blocklist }).state).toBe('checking')
    expect(getProtectionReadiness({ enabled: true, setup: blocklist, nativeStatus: companionStatusFromDebug(null) }).state).toBe('disconnected')
    expect(getProtectionReadiness({ enabled: true, setup: websites, nativeStatus: { ...withMissing(SYSTEM), helperInstalled: false } }).state).toBe('permission')
    expect(getProtectionReadiness({ enabled: true, setup: websites, nativeStatus: NO_HELPER }).state).toBe('helper')
    expect(getProtectionReadiness({ enabled: true, setup: websites, nativeStatus: CONNECTED }).state).toBe('ready')
  })

  it('does not require the website helper for app-only or strict-only protection', () => {
    expect(getProtectionReadiness({ enabled: true, setup: blocklist, nativeStatus: NO_HELPER }).state).toBe('ready')
    expect(getProtectionReadiness({ enabled: true, setup: strictOnly, nativeStatus: NO_HELPER }).state).toBe('ready')
  })

  it('never treats allowed tools alone as protection', () => {
    expect(getProtectionReadiness({ enabled: true, setup: allowedOnly, nativeStatus: CONNECTED }).state).toBe('empty')
  })

  it('reads the Companion debug payload conservatively', () => {
    expect(companionStatusFromDebug(null)).toEqual({ checked: true, connected: false, helperInstalled: false, missingPermissions: [] })
    expect(companionStatusFromDebug({ helperInstalled: 'yes' })).toEqual({ checked: true, connected: true, helperInstalled: false, missingPermissions: [] })
    expect(companionStatusFromDebug({ helperInstalled: true, permissionMissing: '  Safari ' }).missingPermissions).toEqual([SAFARI])
    expect(companionStatusFromDebug({ helperInstalled: true, permissionMissing: 'Safari', missingPermissions: [] }).missingPermissions).toEqual([])
    expect(companionStatusFromDebug({ missingPermissions: ['Safari', 'System Events', 'Safari'] }).missingPermissions).toEqual([SYSTEM, SAFARI])
    expect(companionStatusFromDebug({ permissionMissing: '   ' }).missingPermissions).toEqual([])
    expect(companionStatusFromDebug({ permissionMissing: true }).missingPermissions).toEqual([])
  })
})

describe('which Automation permission blocks which rules', () => {
  it('attributes each Companion report to what it actually blocks', () => {
    expect(permissionTarget('System Events')).toEqual({ name: 'System Events', scope: 'system' })
    expect(permissionTarget('Brave Browser')).toEqual({ name: 'Brave Browser', scope: 'browser' })
    // Legacy unnamed reports are treated as system-wide rather than guessed narrow.
    expect(permissionTarget('Browser (check Automation permissions)')).toEqual({ name: 'System Events', scope: 'system' })
    expect(permissionTarget('Something new')).toMatchObject({ name: 'System Events', scope: 'system' })
    expect(permissionTarget('')).toBeNull()
    expect(permissionTarget(null)).toBeNull()
  })

  it('treats missing System Events access as blocking every kind of rule', () => {
    for (const setup of [blocklist, strictOnly, websites, websiteOnly]) {
      expect(getProtectionReadiness({ enabled: true, setup, nativeStatus: withMissing(SYSTEM) })).toMatchObject({
        state: 'permission',
        permissionScope: 'system',
        permissionMissing: 'System Events',
      })
    }
  })

  it('does not let a browser permission block app or strict protection', () => {
    expect(getProtectionReadiness({ enabled: true, setup: blocklist, nativeStatus: withMissing(SAFARI) })).toMatchObject({ state: 'ready', permissionMissing: null })
    expect(getProtectionReadiness({ enabled: true, setup: strictOnly, nativeStatus: withMissing(SAFARI) }).state).toBe('ready')
  })

  it('requires browser access when websites are blocked, naming every affected browser', () => {
    const chrome = { name: 'Google Chrome', scope: 'browser' }
    expect(getProtectionReadiness({ enabled: true, setup: websiteOnly, nativeStatus: withMissing(SAFARI, chrome) })).toMatchObject({
      state: 'permission',
      permissionScope: 'browser',
      permissionMissing: 'Safari and Google Chrome',
    })
  })

  it('reports System Events alone when it is missing alongside a browser', () => {
    expect(getProtectionReadiness({ enabled: true, setup: websites, nativeStatus: withMissing(SAFARI, SYSTEM) })).toMatchObject({
      permissionScope: 'system',
      permissionMissing: 'System Events',
    })
  })

  it('keeps permission between the connection and helper checks', () => {
    const offline = { checked: true, connected: false, helperInstalled: false, missingPermissions: [SYSTEM] }
    expect(getProtectionReadiness({ enabled: true, setup: websites, nativeStatus: offline }).state).toBe('disconnected')
    expect(getProtectionReadiness({ enabled: true, setup: websites, nativeStatus: { ...withMissing(SAFARI), helperInstalled: false } }).state).toBe('permission')
    expect(getProtectionReadiness({ enabled: false, setup: blocklist, nativeStatus: withMissing(SYSTEM) }).state).toBe('off')
  })

  it('accepts a raw single report and ignores malformed permission lists', () => {
    expect(getProtectionReadiness({ enabled: true, setup: blocklist, nativeStatus: { ...CONNECTED, missingPermissions: undefined, permissionMissing: 'System Events' } }).state).toBe('permission')
    expect(getProtectionReadiness({ enabled: true, setup: blocklist, nativeStatus: { ...CONNECTED, missingPermissions: [{ name: '', scope: 'system' }, { name: 'X', scope: 'other' }, null] } }).state).toBe('ready')
  })
})

describe('native permission reports', () => {
  it('trusts an explicit empty native set over the legacy scalar', () => {
    expect(missingPermissionsFromDebug({ permissionMissing: 'Safari', missingPermissions: [] })).toEqual([])
  })

  it('normalizes, deduplicates, and orders native reports', () => {
    expect(missingPermissionsFromDebug({ missingPermissions: ['Safari', 'Something old', 'Safari', 'Google Chrome'] })).toEqual([
      SYSTEM,
      { name: 'Google Chrome', scope: 'browser' },
      SAFARI,
    ])
  })
})

describe('protection rule counts', () => {
  it('counts a migrated domain-only rule as one distraction covering one website', () => {
    const migrated = normalizeProtectionSetup({ distractionDomains: ['reddit.com'] })
    expect(migrated.distractionApps).toEqual(['reddit.com'])
    expect(protectionRuleCounts(migrated)).toEqual({ distractionCount: 1, websiteCount: 1, strictMode: false })
  })

  it('does not depend on how an entry is capitalised or punctuated', () => {
    const lower = normalizeProtectionSetup({ distractionApps: ['draw.io', 'reddit.com'] })
    const display = normalizeProtectionSetup({ distractionApps: ['Draw.io', 'Reddit.com'] })
    expect(protectionRuleCounts(lower)).toEqual(protectionRuleCounts(display))
    expect(protectionRuleCounts(display)).toMatchObject({ distractionCount: 2, websiteCount: 2 })
  })

  it('counts preset domains and plain app names by the rules they create', () => {
    const setup = normalizeProtectionSetup({ distractionApps: ['YouTube', 'Slack', 'https://www.news.ycombinator.com/item'] })
    expect(protectionRuleCounts(setup)).toMatchObject({ distractionCount: 3, websiteCount: 2 })
  })

  it('makes a dotted app name require permissions like any other rule', () => {
    const dotted = normalizeProtectionSetup({ distractionApps: ['draw.io'] })
    expect(getProtectionReadiness({ enabled: true, setup: dotted, nativeStatus: withMissing(SYSTEM) }).state).toBe('permission')
  })
})
