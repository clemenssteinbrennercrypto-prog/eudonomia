const SOURCE_KEY = 'eudaimonia_activity'
const BRIDGE_KEY = 'eudaimonia_ext_activity'
const SESSION_ACTIVE_KEY = 'eudaimonia_session_active'
const SESSION_END_KEY = 'eudaimonia_session_end_ts'
const FOCUS_APPS_KEY = 'eudaimonia_focus_apps'
const FOCUS_APPS_CONFIG_KEY = 'eudaimonia_focus_apps_config'

function writeActivity(activity) {
  if (!activity) return
  try {
    localStorage.setItem(SOURCE_KEY, JSON.stringify(activity))
    localStorage.setItem(BRIDGE_KEY, JSON.stringify(activity))
  } catch {}
}

function syncToLocalStorage() {
  chrome.storage.local.get(SOURCE_KEY, (result) => {
    writeActivity(result[SOURCE_KEY])
  })
}

function syncSessionFlag() {
  try {
    const active = localStorage.getItem(SESSION_ACTIVE_KEY) === 'true'
    const endTs = localStorage.getItem(SESSION_END_KEY)
    chrome.storage.local.set({ [SESSION_ACTIVE_KEY]: active })
    if (endTs) {
      chrome.storage.local.set({ [SESSION_END_KEY]: endTs })
    } else {
      chrome.storage.local.remove(SESSION_END_KEY)
    }
  } catch {}
}

function syncFocusAppsConfig() {
  try {
    const raw = localStorage.getItem(FOCUS_APPS_KEY)
    if (raw) {
      chrome.storage.local.set({ [FOCUS_APPS_CONFIG_KEY]: JSON.parse(raw) })
    }
  } catch {}
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[SOURCE_KEY]?.newValue) {
    writeActivity(changes[SOURCE_KEY].newValue)
  }
})

setInterval(syncToLocalStorage, 2000)
syncToLocalStorage()
setInterval(syncSessionFlag, 1000)
syncSessionFlag()
setInterval(syncFocusAppsConfig, 5000)
syncFocusAppsConfig()
