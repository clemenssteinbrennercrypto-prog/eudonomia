chrome.storage.local.get('eudaimonia_activity', (result) => {
  const el = document.getElementById('current-url')
  const activity = result.eudaimonia_activity
  el.textContent = activity ? (activity.domain || activity.url) : 'No activity yet'
})
