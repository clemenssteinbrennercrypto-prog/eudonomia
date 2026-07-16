const STORAGE_KEY = 'eudaimonia_ext_activity'
const STALE_MS = 10_000
const DAEMON_BASE_URLS = ['http://127.0.0.1:7331', 'http://localhost:7331']
const DAEMON_POLL_MS = 3000

let lastActivity = { url: null, domain: null, title: null, app: '', ts: 0 }
let lastExtensionTs = 0
let lastDaemonTs = 0
let pollingInterval = null
let daemonInterval = null

function noteSource(source, ts) {
  if (source === 'extension') lastExtensionTs = ts
  if (source === 'daemon') lastDaemonTs = ts
}

function applyIfFresher(activity, onUpdate, source) {
  if (activity?.ts && activity.ts > lastActivity.ts) {
    noteSource(source, activity.ts)
    lastActivity = { ...activity, source }
    onUpdate(lastActivity)
  } else if (activity?.ts) {
    noteSource(source, activity.ts)
  }
}

async function fetchDaemon(path, options = {}) {
  let lastErr = null
  for (const baseUrl of DAEMON_BASE_URLS) {
    try {
      const res = await fetch(`${baseUrl}${path}`, options)
      if (res.ok) return res
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('Companion not reachable')
}

function pollExtensionBridge(onUpdate) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    applyIfFresher(JSON.parse(raw), onUpdate, 'extension')
  } catch {
    // The extension is optional; sessions continue without activity data.
  }
}

async function pollDaemon(onUpdate) {
  try {
    const res = await fetchDaemon('/status', { signal: AbortSignal.timeout(1000) })
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
    }, onUpdate, 'daemon')
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
  return lastDaemonTs > 0 && (Date.now() - lastDaemonTs) < STALE_MS
}

export function isActivityConnected() {
  const newestTs = Math.max(lastActivity.ts || 0, lastExtensionTs, lastDaemonTs)
  return newestTs > 0 && (Date.now() - newestTs) < STALE_MS
}

// Push session state + blocking config to the Companion app (Tauri, port 7331).
// The companion is optional, so failures are reported without breaking sessions.
// While `active` is true the companion enforces blocking on its own: blocked
// native apps get hidden, blocked browser domains get redirected. The endTs
// acts as the companion-side failsafe (blocking self-expires after endTs+grace).
export async function pushCompanionSession({ active, endTs = 0, blockedApps = [], blockedDomains = [], strictMode = false, allowedApps = [], sessionState = null }) {
  try {
    const res = await fetchDaemon('/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active, endTs, blockedApps, blockedDomains, strictMode, allowedApps, sessionState }),
      signal: AbortSignal.timeout(1500),
    })
    const data = await res.json().catch(() => null)
    if (active && data?.active !== true) {
      console.warn('[companion] session push rejected stale session')
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
    const res = await fetchDaemon('/debug', {
      signal: AbortSignal.timeout(2000),
    })
    return res.json()
  } catch {}
  return null
}

// Trigger the companion's one-time helper install. Shows a single macOS admin
// password dialog; after that, website blocking runs silently (no more prompts).
// Long timeout: the request only returns once the user answers the dialog.
export async function installCompanionHelper() {
  try {
    const res = await fetchDaemon('/install-helper', {
      method: 'POST',
      signal: AbortSignal.timeout(120000),
    })
    return res.json()
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

export function isExtensionConnected() {
  return lastExtensionTs > 0 && (Date.now() - lastExtensionTs) < STALE_MS
}
