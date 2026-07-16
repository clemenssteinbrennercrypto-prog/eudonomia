const STORAGE_KEY = 'eudaimonia_ext_activity'
const STALE_MS = 10_000
const DAEMON_STATUS_URL = 'http://localhost:7331/status'
const DAEMON_SESSION_URL = 'http://localhost:7331/session'
const DAEMON_DEBUG_URL = 'http://localhost:7331/debug'
const DAEMON_POLL_MS = 3000

let lastActivity = { url: null, domain: null, title: null, app: '', ts: 0 }
let pollingInterval = null
let daemonInterval = null

function applyIfFresher(activity, onUpdate) {
  if (activity?.ts && activity.ts > lastActivity.ts) {
    lastActivity = activity
    onUpdate(lastActivity)
  }
}

function pollExtensionBridge(onUpdate) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    applyIfFresher(JSON.parse(raw), onUpdate)
  } catch {
    // The extension is optional; sessions continue without activity data.
  }
}

async function pollDaemon(onUpdate) {
  try {
    const res = await fetch(DAEMON_STATUS_URL, { signal: AbortSignal.timeout(1000) })
    if (!res.ok) return
    const data = await res.json()
    if (!data?.ts) return
    // Normalize the daemon's shape to match the browser-extension bridge shape
    // ({app, domain, title, url, ts}) so classifyActivity() in SessionScreen.jsx
    // can treat either source the same. Supports both the legacy Python daemon
    // ({app, window, url, full_url, ts}) and the Tauri companion
    // ({app, window, url, domain, ts}).
    applyIfFresher({
      app: data.app || '',
      domain: data.domain || data.url || '',
      title: data.window || '',
      url: data.full_url || data.url || '',
      ts: data.ts,
    }, onUpdate)
  } catch {
    // The macOS daemon is optional and may not be running; ignore.
  }
}

export function startActivityPolling(onUpdate) {
  if (pollingInterval) return

  const pollExt = () => pollExtensionBridge(onUpdate)
  pollExt()
  pollingInterval = setInterval(pollExt, 2000)

  pollDaemon(onUpdate)
  daemonInterval = setInterval(() => pollDaemon(onUpdate), DAEMON_POLL_MS)
}

export function stopActivityPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }
  if (daemonInterval) {
    clearInterval(daemonInterval)
    daemonInterval = null
  }
}

export function getLastActivity() {
  return lastActivity
}

export function isDaemonConnected() {
  return lastActivity.ts > 0 && (Date.now() - lastActivity.ts) < STALE_MS
}

// Push session state + blocking config to the Companion app (Tauri, port 7331).
// The companion is optional, so failures are reported without breaking sessions.
// While `active` is true the companion enforces blocking on its own: blocked
// native apps get hidden, blocked browser domains get redirected. The endTs
// acts as the companion-side failsafe (blocking self-expires after endTs+grace).
export async function pushCompanionSession({ active, endTs = 0, blockedApps = [], blockedDomains = [], strictMode = false, allowedApps = [] }) {
  try {
    const res = await fetch(DAEMON_SESSION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active, endTs, blockedApps, blockedDomains, strictMode, allowedApps }),
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) {
      console.warn('[companion] session push failed', res.status)
      return false
    }
    return true
  } catch (err) {
    console.warn('[companion] session push failed', err)
    return false
  }
}

export async function fetchCompanionDebug() {
  try {
    const res = await fetch(DAEMON_DEBUG_URL, {
      signal: AbortSignal.timeout(2000),
    })
    if (res.ok) return res.json()
  } catch {}
  return null
}

// Trigger the companion's one-time helper install. Shows a single macOS admin
// password dialog; after that, website blocking runs silently (no more prompts).
// Long timeout: the request only returns once the user answers the dialog.
export async function installCompanionHelper() {
  try {
    const res = await fetch('http://localhost:7331/install-helper', {
      method: 'POST',
      signal: AbortSignal.timeout(120000),
    })
    if (res.ok) return res.json()
    return { ok: false, error: `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

export function isExtensionConnected() {
  return isDaemonConnected()
}
