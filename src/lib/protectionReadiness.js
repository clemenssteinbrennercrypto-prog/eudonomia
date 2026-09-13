import { getDomainsFromAppPreset } from './focusAppsConfig'
import { normalizeProtectionDomain } from './protectionSetups'

export const UNCHECKED_COMPANION_STATUS = Object.freeze({ checked: false, connected: false, helperInstalled: false })

export function companionStatusFromDebug(debug) {
  return {
    checked: true,
    connected: Boolean(debug),
    helperInstalled: debug?.helperInstalled === true,
  }
}

// A list entry that only names a website ("reddit.com"), typed by hand or
// migrated from a legacy domain-only rule. It is enforced through its derived
// domain, so counting it as an app as well would report one rule twice.
export function isWebsiteOnlyEntry(entry) {
  const raw = String(entry || '').trim()
  if (!raw || /\s/.test(raw) || getDomainsFromAppPreset(raw).length) return false
  return normalizeProtectionDomain(raw).includes('.')
}

export function protectionRuleCounts(setup) {
  const distractionApps = Array.isArray(setup?.distractionApps) ? setup.distractionApps : []
  const distractionDomains = Array.isArray(setup?.distractionDomains) ? setup.distractionDomains : []
  return {
    distractionCount: distractionApps.length,
    appCount: distractionApps.filter(entry => !isWebsiteOnlyEntry(entry)).length,
    websiteCount: distractionDomains.length,
    strictMode: setup?.strictMode === true,
  }
}

// One ruler for every "is this session protected?" claim. Protection is only
// `ready` when rules exist AND the native Companion that enforces them has been
// reached — and, when websites are blocked, its hosts helper is installed.
export function getProtectionReadiness({ enabled, setup, nativeStatus }) {
  const counts = protectionRuleCounts(setup)
  const configured = counts.strictMode || counts.distractionCount > 0 || counts.websiteCount > 0
  const state = !enabled
    ? 'off'
    : !configured
      ? 'empty'
      : nativeStatus?.checked !== true
        ? 'checking'
        : nativeStatus.connected !== true
          ? 'disconnected'
          : counts.websiteCount > 0 && nativeStatus.helperInstalled !== true
            ? 'helper'
            : 'ready'
  return { state, ...counts }
}
