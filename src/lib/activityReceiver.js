const STORAGE_KEY = 'eudaimonia_ext_activity'
const STALE_MS = 10_000

let lastActivity = { url: null, domain: null, title: null, ts: 0 }
let pollingInterval = null

export function startActivityPolling(onUpdate) {
  if (pollingInterval) return

  const poll = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const data = JSON.parse(raw)
      if (data?.ts && data.ts !== lastActivity.ts) {
        lastActivity = data
        onUpdate(lastActivity)
      }
    } catch {
      // The extension is optional; sessions continue without activity data.
    }
  }

  poll()
  pollingInterval = setInterval(poll, 2000)
}

export function stopActivityPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
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
