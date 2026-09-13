import { describe, expect, it } from 'vitest'
import {
  UNCHECKED_COMPANION_STATUS,
  companionStatusFromDebug,
  getProtectionReadiness,
  isWebsiteOnlyEntry,
  protectionRuleCounts,
} from './protectionReadiness'
import { normalizeProtectionSetup } from './protectionSetups'

const CONNECTED = { checked: true, connected: true, helperInstalled: true }
const NO_HELPER = { checked: true, connected: true, helperInstalled: false }
const blocklist = normalizeProtectionSetup({ distractionApps: ['Slack'] })
const websites = normalizeProtectionSetup({ distractionApps: ['YouTube'] })
const strictOnly = normalizeProtectionSetup({ strictMode: true })
const allowedOnly = normalizeProtectionSetup({ focusApps: ['VS Code', 'notion.so'] })

describe('protection readiness', () => {
  it('walks every state boundary in order', () => {
    expect(getProtectionReadiness({ enabled: false, setup: blocklist, nativeStatus: CONNECTED }).state).toBe('off')
    expect(getProtectionReadiness({ enabled: true, setup: normalizeProtectionSetup({}), nativeStatus: CONNECTED }).state).toBe('empty')
    expect(getProtectionReadiness({ enabled: true, setup: blocklist, nativeStatus: UNCHECKED_COMPANION_STATUS }).state).toBe('checking')
    expect(getProtectionReadiness({ enabled: true, setup: blocklist }).state).toBe('checking')
    expect(getProtectionReadiness({ enabled: true, setup: blocklist, nativeStatus: companionStatusFromDebug(null) }).state).toBe('disconnected')
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
    expect(companionStatusFromDebug(null)).toEqual({ checked: true, connected: false, helperInstalled: false })
    expect(companionStatusFromDebug({ helperInstalled: 'yes' })).toEqual({ checked: true, connected: true, helperInstalled: false })
    expect(companionStatusFromDebug({ helperInstalled: true })).toEqual({ checked: true, connected: true, helperInstalled: true })
  })
})

describe('protection rule counts', () => {
  it('counts a migrated domain-only rule once, as a website', () => {
    const migrated = normalizeProtectionSetup({ distractionDomains: ['reddit.com'] })
    expect(migrated.distractionApps).toEqual(['reddit.com'])
    expect(protectionRuleCounts(migrated)).toMatchObject({ distractionCount: 1, appCount: 0, websiteCount: 1 })
  })

  it('keeps preset apps and plain app names as apps', () => {
    const setup = normalizeProtectionSetup({ distractionApps: ['YouTube', 'Slack', 'https://www.news.ycombinator.com/item'] })
    expect(protectionRuleCounts(setup)).toMatchObject({ distractionCount: 3, appCount: 2, websiteCount: 2 })
  })

  it('only classifies single hostname-like entries as websites', () => {
    expect(isWebsiteOnlyEntry('reddit.com')).toBe(true)
    expect(isWebsiteOnlyEntry('https://www.reddit.com/r/all')).toBe(true)
    expect(isWebsiteOnlyEntry('Reddit')).toBe(false)
    expect(isWebsiteOnlyEntry('Twitter/X')).toBe(false)
    expect(isWebsiteOnlyEntry('Things 3.1')).toBe(false)
    expect(isWebsiteOnlyEntry('')).toBe(false)
  })
})
