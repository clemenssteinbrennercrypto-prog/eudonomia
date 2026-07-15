function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
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
