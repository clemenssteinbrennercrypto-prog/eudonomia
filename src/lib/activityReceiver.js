const DAEMON_URL = 'http://localhost:7331'

let lastActivity = { app: null, window: null, url: null, full_url: null, ts: 0 }
let pollingInterval = null

export function startActivityPolling(onUpdate) {
  if (pollingInterval) return
  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`${DAEMON_URL}/status`, { signal: AbortSignal.timeout(1000) })
      if (res.ok) {
        const data = await res.json()
        lastActivity = { ...data, ts: Date.now() }
        onUpdate(lastActivity)
      }
    } catch {
      // Daemon is optional; sessions continue without activity data.
    }
  }, 3000)
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
  return Date.now() - lastActivity.ts < 6000
}
