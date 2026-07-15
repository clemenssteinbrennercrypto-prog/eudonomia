const STORAGE_KEY = 'eudaimonia_ext_activity'
const STALE_MS = 10_000
const DAEMON_STATUS_URL = 'http://localhost:7331/status'
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
    // Normalize the daemon's shape ({app, window, url, full_url, ts}) to match
    // the browser-extension bridge shape ({app, domain, title, url, ts}) so
    // classifyActivity() in SessionScreen.jsx can treat either source the same.
    applyIfFresher({
      app: data.app || '',
      domain: data.url || '',
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

export function isExtensionConnected() {
  return isDaemonConnected()
}
