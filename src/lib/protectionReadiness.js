import { getDomainsFromAppPreset } from './focusAppsConfig'
import { normalizeProtectionDomain } from './protectionSetups'

export const UNCHECKED_COMPANION_STATUS = Object.freeze({ checked: false, connected: false, helperInstalled: false, permissionMissing: null })

export function companionStatusFromDebug(debug) {
  const permissionMissing = typeof debug?.permissionMissing === 'string' && debug.permissionMissing.trim()
    ? debug.permissionMissing.trim()
    : null
  return {
    checked: true,
    connected: Boolean(debug),
    helperInstalled: debug?.helperInstalled === true,
    // The Companion hides apps through Automation (osascript). When macOS
    // refuses that access it reports what is missing here.
    permissionMissing: debug ? permissionMissing : null,
  }
}

const URL_MARKERS = /^[a-z][a-z0-9+.-]*:\/\/|^www\.|[/?#:]/i

// A list entry that only names a website ("reddit.com"), typed by hand or
// migrated from a legacy domain-only rule. It is enforced through its derived
// domain, so counting it as an app as well would report one rule twice.
// Only entries written as a URL or as an exact lowercase hostname qualify:
// app display names that happen to contain a dot keep their capitals
// ("Draw.io", "Notion.app") and still count as apps. A lowercase bare
// hostname such as "draw.io" is indistinguishable from a website rule and is
// counted as one.
export function isWebsiteOnlyEntry(entry) {
  const raw = String(entry || '').trim()
  if (!raw || /\s/.test(raw) || getDomainsFromAppPreset(raw).length) return false
  const host = normalizeProtectionDomain(raw)
  if (!host.includes('.')) return false
  return URL_MARKERS.test(raw) || raw === host
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
// reached, has the Automation access app hiding needs (when apps are hidden),
// and, when websites are blocked, has its hosts helper installed.
export function getProtectionReadiness({ enabled, setup, nativeStatus }) {
  const counts = protectionRuleCounts(setup)
  const configured = counts.strictMode || counts.distractionCount > 0 || counts.websiteCount > 0
  const hidesApps = counts.strictMode || counts.appCount > 0
  const permissionMissing = typeof nativeStatus?.permissionMissing === 'string' && nativeStatus.permissionMissing
    ? nativeStatus.permissionMissing
    : null
  const state = !enabled
    ? 'off'
    : !configured
      ? 'empty'
      : nativeStatus?.checked !== true
        ? 'checking'
        : nativeStatus.connected !== true
          ? 'disconnected'
          : hidesApps && permissionMissing
            ? 'permission'
            : counts.websiteCount > 0 && nativeStatus.helperInstalled !== true
              ? 'helper'
              : 'ready'
  return { state, ...counts, permissionMissing: state === 'permission' ? permissionMissing : null }
}
