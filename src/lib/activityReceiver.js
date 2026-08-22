import { fetchActivityStatus, listenActivityUpdates } from './nativeCompanion'

const STALE_MS = 10_000

let lastActivity = { url: null, domain: null, title: null, app: '', ts: 0 }
let lastCompanionTs = 0
let activityUnlisten = null
let listenerGeneration = 0

function normalizeActivity(data) {
  if (!data?.ts) return null
  return {
    app: data.app || '',
    domain: data.domain || '',
    title: data.window || data.title || '',
    url: data.url || '',
    ts: Number(data.ts),
    source: 'companion',
  }
}

function applyIfFresher(data, onUpdate) {
  const activity = normalizeActivity(data)
  if (!activity) return
  lastCompanionTs = Math.max(lastCompanionTs, activity.ts)
  if (activity.ts <= lastActivity.ts) return
  lastActivity = activity
  onUpdate(lastActivity)
}

export function startActivityUpdates(onUpdate) {
  const generation = ++listenerGeneration

  fetchActivityStatus().then(activity => {
    if (generation === listenerGeneration) applyIfFresher(activity, onUpdate)
  })

  listenActivityUpdates(activity => {
    if (generation === listenerGeneration) applyIfFresher(activity, onUpdate)
  }).then(unlisten => {
    if (generation !== listenerGeneration) {
      unlisten()
      return
    }
    activityUnlisten?.()
    activityUnlisten = unlisten
  })
}

export function stopActivityUpdates() {
  listenerGeneration += 1
  activityUnlisten?.()
  activityUnlisten = null
}

export function getLastActivity() {
  return lastActivity
}

export function isActivityConnected() {
  return lastCompanionTs > 0 && Date.now() - lastCompanionTs < STALE_MS
}
