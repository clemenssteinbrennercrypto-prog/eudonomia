export const SYSTEM_EVENTS_PERMISSION = 'System Events'

// Browsers whose tabs the Companion reads and redirects through Automation
// (companion/src-tauri/src/activity.rs: browser_url, redirect_browser_tab).
export const COMPANION_AUTOMATION_BROWSERS = Object.freeze(['Safari', 'Google Chrome', 'Arc', 'Brave Browser'])

export const UNCHECKED_COMPANION_STATUS = Object.freeze({
  checked: false,
  connected: false,
  helperInstalled: false,
  missingPermissions: Object.freeze([]),
})

// Maps one Companion permission report to what it actually blocks:
// - `system`: System Events. The Companion learns the frontmost app through it
//   on every poll, so without it no app is hidden and no tab is redirected.
// - `browser`: one browser's Automation. Only closing blocked sites in that
//   browser fails; app hiding still works.
// Unnamed and unknown reports are attributed to System Events: the only
// unnamed Automation call hides apps through it, and guessing narrower would
// overclaim protection.
export function permissionTarget(report) {
  const name = typeof report === 'string' ? report.trim() : ''
  if (!name) return null
  if (COMPANION_AUTOMATION_BROWSERS.includes(name)) return { name, scope: 'browser' }
  return { name: SYSTEM_EVENTS_PERMISSION, scope: 'system' }
}

// New Companion builds keep the complete permission set in native state, so
// it survives React screen changes and can be cleared only by a successful
// AppleScript call to that same target. The legacy scalar remains a safe
// fallback for older debug payloads.
export function missingPermissionsFromDebug(debug) {
  const reports = Array.isArray(debug?.missingPermissions)
    ? debug.missingPermissions
    : [debug?.permissionMissing]
  const byName = new Map()
  for (const report of reports) {
    const target = permissionTarget(report)
    if (target) byName.set(target.name, target)
  }
  return [...byName.values()]
    .sort((a, b) => (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === 'system' ? -1 : 1))
}

export function companionStatusFromDebug(debug) {
  return {
    checked: true,
    connected: Boolean(debug),
    helperInstalled: debug?.helperInstalled === true,
    missingPermissions: debug ? missingPermissionsFromDebug(debug) : [],
  }
}

function missingPermissionsOf(nativeStatus) {
  if (Array.isArray(nativeStatus?.missingPermissions)) {
    return nativeStatus.missingPermissions.filter(item => typeof item?.name === 'string' && item.name && (item.scope === 'system' || item.scope === 'browser'))
  }
  const target = permissionTarget(nativeStatus?.permissionMissing)
  return target ? [{ name: target.name, scope: target.scope }] : []
}

// Counts describe rules, not a guess about what each entry is. Every
// distraction entry is sent to the Companion as an app name, and its derived
// domains are blocked as websites; a lone "reddit.com" is one distraction
// covering one website, not an app plus a website.
export function protectionRuleCounts(setup) {
  const distractionApps = Array.isArray(setup?.distractionApps) ? setup.distractionApps : []
  const distractionDomains = Array.isArray(setup?.distractionDomains) ? setup.distractionDomains : []
  return {
    distractionCount: distractionApps.length,
    websiteCount: distractionDomains.length,
    strictMode: setup?.strictMode === true,
  }
}

function joinNames(names) {
  return names.length <= 1 ? (names[0] || '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// One ruler for every "is this session protected?" claim. Protection is only
// `ready` when rules exist AND the native Companion that enforces them has been
// reached, holds the Automation access those rules depend on, and, when
// websites are blocked, has its hosts helper installed.
export function getProtectionReadiness({ enabled, setup, nativeStatus }) {
  const counts = protectionRuleCounts(setup)
  const configured = counts.strictMode || counts.distractionCount > 0 || counts.websiteCount > 0
  const missing = missingPermissionsOf(nativeStatus)
  // System Events blocks every rule. A browser only matters when websites are
  // blocked: /etc/hosts alone misses browsers using DNS-over-HTTPS, so closing
  // the tab is part of website protection.
  const blocking = missing.some(item => item.scope === 'system')
    ? missing.filter(item => item.scope === 'system')
    : counts.websiteCount > 0 ? missing.filter(item => item.scope === 'browser') : []
  const state = !enabled
    ? 'off'
    : !configured
      ? 'empty'
      : nativeStatus?.checked !== true
        ? 'checking'
        : nativeStatus.connected !== true
          ? 'disconnected'
          : blocking.length > 0
            ? 'permission'
            : counts.websiteCount > 0 && nativeStatus.helperInstalled !== true
              ? 'helper'
              : 'ready'
  const permission = state === 'permission'
  return {
    state,
    ...counts,
    permissionScope: permission ? blocking[0].scope : null,
    permissionMissing: permission ? joinNames(blocking.map(item => item.name)) : null,
  }
}
