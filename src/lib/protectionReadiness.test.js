import { describe, expect, it } from 'vitest'
import {
  UNCHECKED_COMPANION_STATUS,
  UNNAMED_PERMISSION_HOLD_MS,
  companionStatusFromDebug,
  getProtectionReadiness,
  missingPermissionsFromLatch,
  nextPermissionLatch,
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
    expect(companionStatusFromDebug({ permissionMissing: '   ' }).missingPermissions).toEqual([])
    expect(companionStatusFromDebug({ permissionMissing: true }).missingPermissions).toEqual([])
  })
})

describe('which Automation permission blocks which rules', () => {
  it('attributes each Companion report to what it actually blocks', () => {
    expect(permissionTarget('System Events')).toEqual({ name: 'System Events', scope: 'system', named: true })
    expect(permissionTarget('Brave Browser')).toEqual({ name: 'Brave Browser', scope: 'browser', named: true })
    // hide_app names no target, so the Companion falls back to this label.
    expect(permissionTarget('Browser (check Automation permissions)')).toEqual({ name: 'System Events', scope: 'system', named: false })
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

describe('permission latch', () => {
  const T = 1_000_000
  const debugAt = (overrides = {}) => ({ helperInstalled: true, lastActivity: { app: 'Slack', url: null, ts: T - 1000 }, ...overrides })

  it('keeps a browser report after the user switches away from that browser', () => {
    let latch = nextPermissionLatch({}, debugAt({ permissionMissing: 'Safari', lastActivity: { app: 'Safari', url: null, ts: T - 100 } }), T)
    latch = nextPermissionLatch(latch, debugAt({ lastActivity: { app: 'Slack', url: null, ts: T + 3000 } }), T + 3000)
    latch = nextPermissionLatch(latch, debugAt({ lastActivity: { app: 'Terminal', url: null, ts: T + 60_000 } }), T + 60_000)

    expect(missingPermissionsFromLatch(latch)).toEqual([SAFARI])
  })

  it('clears a browser report only when that browser later yields a URL', () => {
    let latch = nextPermissionLatch({}, debugAt({ permissionMissing: 'Safari' }), T)
    latch = nextPermissionLatch(latch, debugAt({ lastActivity: { app: 'Safari', url: null, ts: T + 3000 } }), T + 3000)
    expect(missingPermissionsFromLatch(latch)).toEqual([SAFARI])

    latch = nextPermissionLatch(latch, debugAt({ lastActivity: { app: 'Google Chrome', url: 'https://example.com', ts: T + 6000 } }), T + 6000)
    expect(missingPermissionsFromLatch(latch)).toEqual([SAFARI])

    latch = nextPermissionLatch(latch, debugAt({ lastActivity: { app: 'Safari', url: 'https://example.com', ts: T - 5 } }), T + 9000)
    expect(missingPermissionsFromLatch(latch)).toEqual([SAFARI])

    latch = nextPermissionLatch(latch, debugAt({ lastActivity: { app: 'Safari', url: 'https://example.com', ts: T + 12_000 } }), T + 12_000)
    expect(missingPermissionsFromLatch(latch)).toEqual([])
  })

  it('clears a named System Events report once frontmost detection works again', () => {
    let latch = nextPermissionLatch({}, debugAt({ permissionMissing: 'System Events' }), T)
    latch = nextPermissionLatch(latch, debugAt(), T + 3000)
    expect(missingPermissionsFromLatch(latch)).toEqual([SYSTEM])

    latch = nextPermissionLatch(latch, debugAt({ lastActivity: { app: 'Slack', url: null, ts: T + 6000 } }), T + 6000)
    expect(missingPermissionsFromLatch(latch)).toEqual([])
  })

  it('holds an unnamed report for the full hold window despite fresh activity', () => {
    const unnamed = 'Browser (check Automation permissions)'
    let latch = nextPermissionLatch({}, debugAt({ permissionMissing: unnamed }), T)
    const fresh = at => debugAt({ lastActivity: { app: 'Slack', url: null, ts: at } })

    latch = nextPermissionLatch(latch, fresh(T + UNNAMED_PERMISSION_HOLD_MS - 1), T + UNNAMED_PERMISSION_HOLD_MS - 1)
    expect(missingPermissionsFromLatch(latch)).toEqual([SYSTEM])

    latch = nextPermissionLatch(latch, fresh(T + UNNAMED_PERMISSION_HOLD_MS), T + UNNAMED_PERMISSION_HOLD_MS)
    expect(missingPermissionsFromLatch(latch)).toEqual([])
  })

  it('restarts the hold on a repeated report and never downgrades a named one', () => {
    const unnamed = 'Browser (check Automation permissions)'
    let latch = nextPermissionLatch({}, debugAt({ permissionMissing: unnamed }), T)
    latch = nextPermissionLatch(latch, debugAt({ permissionMissing: unnamed }), T + 60_000)
    latch = nextPermissionLatch(latch, debugAt(), T + UNNAMED_PERMISSION_HOLD_MS + 1)
    expect(missingPermissionsFromLatch(latch)).toEqual([SYSTEM])

    let named = nextPermissionLatch({}, debugAt({ permissionMissing: 'System Events' }), T)
    named = nextPermissionLatch(named, debugAt({ permissionMissing: unnamed }), T + 1000)
    expect(named['System Events'].named).toBe(true)
  })

  it('drops everything when the Companion disappears', () => {
    const latch = nextPermissionLatch({}, debugAt({ permissionMissing: 'Safari' }), T)
    expect(nextPermissionLatch(latch, null, T + 3000)).toEqual({})
  })

  it('lists System Events before browsers', () => {
    let latch = nextPermissionLatch({}, debugAt({ permissionMissing: 'Safari' }), T)
    latch = nextPermissionLatch(latch, debugAt({ permissionMissing: 'System Events', lastActivity: { app: 'Safari', url: null, ts: T - 1 } }), T + 3000)
    expect(missingPermissionsFromLatch(latch)).toEqual([SYSTEM, SAFARI])
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
