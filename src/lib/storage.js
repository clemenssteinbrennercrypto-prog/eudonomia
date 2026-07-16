// ── Session History Storage ───────────────────────────────────────────────────
// Persists sessions to localStorage under key 'eudaimonia_sessions'
// Max 100 sessions kept (oldest purged first)

import { getDomainFromAppPreset, getDomainsFromAppPreset } from './focusAppsConfig'

const STORAGE_KEY = 'eudaimonia_sessions'
const MAX_SESSIONS = 100
export const FOCUS_APPS_KEY = 'eudaimonia_focus_apps'
export const FOCUS_MODE_KEY = 'eudaimonia_focus_mode_enabled'

function normalizeAppList(apps) {
  if (!Array.isArray(apps)) return []
  const seen = new Set()
  return apps
    .map(app => String(app || '').trim())
    .filter(Boolean)
    .filter(app => {
      const key = app.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function normalizeDomain(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
    const host = new URL(withProtocol).hostname
    return host.replace(/^www\./, '')
  } catch {
    return raw
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split('?')[0]
      .trim()
  }
}

function normalizeDomainList(domains) {
  if (!Array.isArray(domains)) return []
  const seen = new Set()
  return domains
    .map(normalizeDomain)
    .filter(Boolean)
    .filter(domain => {
      if (seen.has(domain)) return false
      seen.add(domain)
      return true
    })
}

export { getDomainFromAppPreset, getDomainsFromAppPreset }

function deriveDomainsFromApps(apps) {
  return apps.flatMap(app => {
    const presetDomains = getDomainsFromAppPreset(app)
    if (presetDomains.length) return presetDomains
    const normalized = normalizeDomain(app)
    return normalized.includes('.') ? [normalized] : []
  })
}

export function saveSession(sessionData) {
  const sessions = loadSessions()
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    ...sessionData,
  }
  sessions.unshift(entry) // newest first
  if (sessions.length > MAX_SESSIONS) sessions.splice(MAX_SESSIONS)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch {}
  return entry
}

export function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

export function deleteSession(id) {
  const sessions = loadSessions().filter((s) => s.id !== id)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch {}
}

export function updateSession(id, patch) {
  const sessions = loadSessions().map(s => s.id === id ? { ...s, ...patch } : s)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch {}
}

export function clearAllSessions() {
  localStorage.removeItem(STORAGE_KEY)
}

export function loadFocusAppsConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(FOCUS_APPS_KEY) || '{}')
    const focusApps = normalizeAppList(raw.focusApps)
    const distractionApps = normalizeAppList(raw.distractionApps)
    return {
      focusApps,
      distractionApps,
      focusDomains: normalizeDomainList([
        ...deriveDomainsFromApps(focusApps),
        ...(raw.focusDomains || []),
      ]),
      distractionDomains: normalizeDomainList([
        ...deriveDomainsFromApps(distractionApps),
        ...(raw.distractionDomains || []),
      ]),
    }
  } catch {
    return { focusApps: [], distractionApps: [], focusDomains: [], distractionDomains: [] }
  }
}

export function saveFocusAppsConfig(config) {
  const focusApps = normalizeAppList(config?.focusApps)
  const distractionApps = normalizeAppList(config?.distractionApps)
  const normalized = {
    focusApps,
    distractionApps,
    focusDomains: normalizeDomainList([
      ...deriveDomainsFromApps(focusApps),
      ...(config?.focusDomains || []),
    ]),
    distractionDomains: normalizeDomainList([
      ...deriveDomainsFromApps(distractionApps),
      ...(config?.distractionDomains || []),
    ]),
  }
  try {
    localStorage.setItem(FOCUS_APPS_KEY, JSON.stringify(normalized))
  } catch {}
  return normalized
}

export function loadFocusModeEnabled() {
  try {
    const stored = localStorage.getItem(FOCUS_MODE_KEY)
    return stored == null ? true : stored === 'true'
  } catch {
    return true
  }
}

export function saveFocusModeEnabled(enabled) {
  const next = Boolean(enabled)
  try {
    localStorage.setItem(FOCUS_MODE_KEY, String(next))
  } catch {}
  return next
}

const STRICT_MODE_KEY = 'eudaimonia_strict_mode'

// Strict/allowlist mode: during a session the companion hides every non-browser
// app except the focus apps (allowed) and base system apps. Off by default —
// it's the aggressive "full focus" option, opt-in.
export function loadStrictMode() {
  try {
    return localStorage.getItem(STRICT_MODE_KEY) === 'true'
  } catch {
    return false
  }
}

export function saveStrictMode(enabled) {
  const next = Boolean(enabled)
  try {
    localStorage.setItem(STRICT_MODE_KEY, String(next))
  } catch {}
  return next
}
