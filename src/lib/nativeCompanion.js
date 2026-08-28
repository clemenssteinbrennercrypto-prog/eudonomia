function getNativeApi() {
  return globalThis.window?.__TAURI__ || null
}

async function invokeNative(command, args) {
  const invoke = getNativeApi()?.core?.invoke
  if (!invoke) return null
  return args === undefined ? invoke(command) : invoke(command, args)
}

async function listenNative(eventName, onPayload) {
  const listen = getNativeApi()?.event?.listen
  if (!listen) return () => {}
  try {
    return await listen(eventName, event => onPayload(event?.payload))
  } catch {
    return () => {}
  }
}

function normalizeSessionState(value, active = false) {
  const state = String(value || '').trim().toLowerCase()
  if (['active', 'paused', 'ended', 'inactive'].includes(state)) return state
  return active ? 'active' : 'inactive'
}

export function normalizeCompanionSession(data) {
  if (!data) return null
  const active = data.sessionActive ?? data.active ?? false
  const sessionState = normalizeSessionState(data.sessionState, active)
  return {
    active: active === true && sessionState === 'active',
    sessionActive: active === true && sessionState === 'active',
    sessionState,
    sessionEndTs: Number(data.sessionEndTs || data.endTs || 0),
    sessionUpdatedTs: Number(data.sessionUpdatedTs || data.receivedAt || 0),
    receivedAt: Number(data.receivedAt || 0),
  }
}

export async function fetchActivityStatus() {
  try {
    return await invokeNative('get_activity_status')
  } catch {
    return null
  }
}

export function listenActivityUpdates(onUpdate) {
  return listenNative('activity-updated', onUpdate)
}

// Debug state contains private activity details. It must only cross Tauri's
// in-process IPC boundary; never fall back to localhost HTTP.
export async function fetchCompanionDebug() {
  try {
    return await invokeNative('get_companion_debug')
  } catch {
    return null
  }
}

export async function fetchCompanionSession() {
  try {
    return normalizeCompanionSession(await invokeNative('get_companion_session'))
  } catch {
    return null
  }
}

export function listenCompanionSession(onUpdate) {
  return listenNative('session-state-changed', payload => {
    const session = normalizeCompanionSession(payload)
    if (session) onUpdate(session)
  })
}

export function listenWindowLifecycle(onUpdate) {
  return listenNative('window-lifecycle', payload => {
    if (payload?.state === 'hidden' || payload?.state === 'visible') onUpdate(payload)
  })
}

export async function pushCompanionSession({
  active,
  endTs = 0,
  blockedApps = [],
  blockedDomains = [],
  strictMode = false,
  allowedApps = [],
  sessionState = null,
}) {
  try {
    const data = await invokeNative('set_companion_session', {
      payload: { active, endTs, blockedApps, blockedDomains, strictMode, allowedApps, sessionState },
    })
    const session = normalizeCompanionSession(data)
    if (active && session?.active !== true) return false
    return session || false
  } catch {
    return false
  }
}

export async function installCompanionHelper() {
  try {
    return await invokeNative('install_blocking_helper')
      || { ok: false, error: 'Native runtime unavailable' }
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  }
}

export async function setOutputWatchFolder(path) {
  try {
    return await invokeNative('set_output_watch_folder', { path: path || '' })
  } catch {
    return null
  }
}

export async function fetchOutputDelta() {
  try {
    const data = await invokeNative('get_output_delta')
    return data?.watched ? data : null
  } catch {
    return null
  }
}
