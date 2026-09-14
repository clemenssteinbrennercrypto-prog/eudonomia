export const SYSTEM_EVENTS_PERMISSION = 'System Events'

// Browsers whose tabs the Companion reads and redirects through Automation
// (companion/src-tauri/src/activity.rs: browser_url, redirect_browser_tab).
export const COMPANION_AUTOMATION_BROWSERS = Object.freeze(['Safari', 'Google Chrome', 'Arc', 'Brave Browser'])

// A report without a named target ("Browser (check Automation permissions)")
// comes from an osascript call that names no app, which can succeed again only
// when it next runs. Hold it this long before trusting its absence.
export const UNNAMED_PERMISSION_HOLD_MS = 2 * 60 * 1000

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
  if (COMPANION_AUTOMATION_BROWSERS.includes(name)) return { name, scope: 'browser', named: true }
  return { name: SYSTEM_EVENTS_PERMISSION, scope: 'system', named: name === SYSTEM_EVENTS_PERMISSION }
}

// The Companion clears `permissionMissing` whenever any named osascript call
// succeeds, and only asks a browser while it is frontmost. The raw report
// therefore comes and goes as the user switches apps. This latch keeps a
// report until the Companion's own activity shows the permission working:
// - a browser: an activity from that browser, newer than the report, that
//   carries a URL (reading the URL is the Automation call that failed);
// - System Events: any activity newer than the report (frontmost detection is
//   the System Events call, and activity only updates when it succeeds);
// - an unnamed report: no repeat for UNNAMED_PERMISSION_HOLD_MS.
export function nextPermissionLatch(latch, debug, now = Date.now()) {
  if (!debug) return {}
  const target = permissionTarget(debug.permissionMissing)
  const activity = debug.lastActivity
  const activityTs = Number(activity?.ts) || 0
  const next = {}
  for (const [name, entry] of Object.entries(latch || {})) {
    if (target?.name === name) continue
    const resolved = entry.scope === 'browser'
      ? activity?.app === name && Boolean(activity?.url) && activityTs > entry.reportedAt
      : entry.named
        ? activityTs > entry.reportedAt
        : now - entry.reportedAt >= UNNAMED_PERMISSION_HOLD_MS
    if (!resolved) next[name] = entry
  }
  if (target) {
    const previous = latch?.[target.name]
    next[target.name] = {
      scope: target.scope,
      // Once System Events is reported by name, an unnamed repeat must not
      // downgrade it to the time-based hold.
      named: target.named || previous?.named === true,
      reportedAt: now,
    }
  }
  return next
}

export function missingPermissionsFromLatch(latch) {
  return Object.entries(latch || {})
    .map(([name, entry]) => ({ name, scope: entry.scope }))
    .sort((a, b) => (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === 'system' ? -1 : 1))
}

export function companionStatusFromDebug(debug, latch = nextPermissionLatch({}, debug)) {
  return {
    checked: true,
    connected: Boolean(debug),
    helperInstalled: debug?.helperInstalled === true,
    missingPermissions: debug ? missingPermissionsFromLatch(latch) : [],
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
