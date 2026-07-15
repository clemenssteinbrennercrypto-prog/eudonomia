const SOURCE_KEY = 'eudaimonia_activity'
const BRIDGE_KEY = 'eudaimonia_ext_activity'

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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[SOURCE_KEY]?.newValue) {
    writeActivity(changes[SOURCE_KEY].newValue)
  }
})

setInterval(syncToLocalStorage, 2000)
syncToLocalStorage()
