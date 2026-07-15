function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function normalizeDomain(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
    return new URL(withProtocol).hostname.replace(/^www\./, '')
  } catch {
    return raw
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split('?')[0]
      .trim()
  }
}

function domainMatches(domain, blockedDomains) {
  const normalizedDomain = normalizeDomain(domain)
  if (!normalizedDomain) return false
  return blockedDomains.has(normalizedDomain) ||
    [...blockedDomains].some(blockedDomain => normalizedDomain.endsWith(`.${blockedDomain}`))
}

function canTrackUrl(url) {
  return Boolean(url) &&
    !url.startsWith('chrome://') &&
    !url.startsWith('chrome-extension://') &&
    !url.startsWith('edge://') &&
    !url.startsWith('about:')
}

function updateActivity(tab) {
  if (!canTrackUrl(tab?.url)) return

  const activity = {
    url: tab.url,
    domain: extractDomain(tab.url),
    title: tab.title || '',
    ts: Date.now(),
  }

  chrome.storage.local.set({ eudaimonia_activity: activity })
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId)
    updateActivity(tab)
  } catch {}
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    updateActivity(tab)
  }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading') return
  if (!tab.url || !canTrackUrl(tab.url)) return

  const domain = extractDomain(tab.url)
  const normalizedUrl = tab.url.toLowerCase()

  chrome.storage.local.get(['eudaimonia_focus_apps_config', 'eudaimonia_session_active', 'eudaimonia_session_end_ts'], (result) => {
    const sessionActive = result.eudaimonia_session_active === true
    if (!sessionActive) return

    // Failsafe: if the app tab was closed (or the browser crashed) before the
    // session ended normally, the content script never flips session_active
    // back to false — the flag would stay true forever and block distraction
    // sites indefinitely. session_end_ts is the planned end of the session; if
    // that moment has passed (+2 min grace for overtime), treat the session as
    // over and clear the stale flag. A missing/invalid end_ts also means we
    // cannot prove a session is genuinely running, so don't block.
    const endTs = Number(result.eudaimonia_session_end_ts)
    const GRACE_MS = 2 * 60 * 1000
    if (!Number.isFinite(endTs) || endTs <= 0 || Date.now() > endTs + GRACE_MS) {
      chrome.storage.local.set({ eudaimonia_session_active: false })
      chrome.storage.local.remove('eudaimonia_session_end_ts')
      return
    }

    const config = result.eudaimonia_focus_apps_config || { distractionApps: [], distractionDomains: [] }
    const blockedDomains = new Set([
      ...(config.distractionApps || []),
      ...(config.distractionDomains || []),
    ].map(normalizeDomain).filter(Boolean))
    const blockedEntries = new Set(
      (config.distractionApps || []).map(app => String(app || '').trim().toLowerCase()).filter(Boolean)
    )

    if (domainMatches(domain, blockedDomains) || blockedEntries.has(normalizedUrl)) {
      const blockUrl = `${chrome.runtime.getURL('blocked.html')}?blocked=${encodeURIComponent(domain)}`
      chrome.tabs.update(tabId, { url: blockUrl })
    }
  })
})

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId })
    if (tab) updateActivity(tab)
  } catch {}
})

setInterval(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab) updateActivity(tab)
  } catch {}
}, 3000)
