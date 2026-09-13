// ── Session History Storage ───────────────────────────────────────────────────
// Persists sessions to localStorage under key 'eudaimonia_sessions'
// Max 100 sessions kept (oldest purged first)

import { getDomainFromAppPreset, getDomainsFromAppPreset } from './focusAppsConfig'
import {
  getActiveProtectionSetup,
  normalizeProtectionState,
  updateActiveProtectionSetup,
} from './protectionSetups'
import {
  addSessionToFocusLedger,
  backfillFocusLedger,
  emptyFocusLedger,
  removeSessionFromFocusLedger,
  withSessionFocusMetric,
} from './focusMetric'

const STORAGE_KEY = 'eudaimonia_sessions'
const MAX_SESSIONS = 100
export const FOCUS_LEDGER_KEY = 'eudaimonia_focus_daily_v1'
export const FOCUS_APPS_KEY = 'eudaimonia_focus_apps'
export const PROTECTION_SETUPS_KEY = 'eudaimonia_protection_setups_v1'
export const FOCUS_MODE_KEY = 'eudaimonia_focus_mode_enabled'
export const HISTORY_DELETION_PENDING_KEY = 'eudaimonia_history_deletion_pending'

export { getDomainFromAppPreset, getDomainsFromAppPreset }

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
  saveFocusLedger(addSessionToFocusLedger(loadFocusLedger(), entry))
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
  saveFocusLedger(removeSessionFromFocusLedger(loadFocusLedger(), id))
}

export function updateSession(id, patch) {
  const sessions = loadSessions().map(s => s.id === id ? { ...s, ...patch } : s)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch {}
}

export function clearAllSessions() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(FOCUS_LEDGER_KEY)
}

/** Remove only history, reporting storage failures instead of hiding them. */
export function clearLegacyHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(FOCUS_LEDGER_KEY)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  }
}

export function markHistoryDeletionPending() {
  try {
    localStorage.setItem(HISTORY_DELETION_PENDING_KEY, 'true')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  }
}

export function clearHistoryDeletionPending() {
  try {
    localStorage.removeItem(HISTORY_DELETION_PENDING_KEY)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  }
}

export function isHistoryDeletionPending() {
  try { return localStorage.getItem(HISTORY_DELETION_PENDING_KEY) === 'true' } catch { return false }
}

export function loadFocusLedger() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOCUS_LEDGER_KEY) || 'null')
    return parsed?.schemaVersion === 1 && parsed.days && typeof parsed.days === 'object'
      ? parsed
      : emptyFocusLedger()
  } catch {
    return emptyFocusLedger()
  }
}

function saveFocusLedger(ledger) {
  try {
    localStorage.setItem(FOCUS_LEDGER_KEY, JSON.stringify(ledger))
  } catch {}
}

// Catches up the ledger and persists explicit schema upgrades for recoverable
// pre-ledger timelines. Cheap and idempotent — safe to call on every app start.
// See backfillFocusLedger for what it will and won't touch.
export function backfillFocusLedgerFromSessions() {
  const sessions = loadSessions()
  const upgradedSessions = sessions.map(withSessionFocusMetric)
  if (JSON.stringify(upgradedSessions) !== JSON.stringify(sessions)) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(upgradedSessions)) } catch {}
  }
  const before = loadFocusLedger()
  const after = backfillFocusLedger(before, upgradedSessions)
  if (after !== before) saveFocusLedger(after)
  return after
}

export function loadFocusAppsConfig() {
  return getActiveProtectionSetup(loadProtectionSetups())
}

function loadLegacyFocusAppsConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(FOCUS_APPS_KEY) || '{}')
    return { ...raw, strictMode: localStorage.getItem(STRICT_MODE_KEY) === 'true' }
  } catch {
    return { focusApps: [], distractionApps: [], focusDomains: [], distractionDomains: [], strictMode: false }
  }
}

export function saveFocusAppsConfig(config) {
  const state = updateActiveProtectionSetup(loadProtectionSetups(), config)
  return getActiveProtectionSetup(saveProtectionSetups(state))
}

export function loadProtectionSetups() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROTECTION_SETUPS_KEY) || 'null')
    return normalizeProtectionState(raw, loadLegacyFocusAppsConfig())
  } catch {
    return normalizeProtectionState(null, loadLegacyFocusAppsConfig())
  }
}

export function saveProtectionSetups(state) {
  const normalized = normalizeProtectionState(state)
  const active = getActiveProtectionSetup(normalized)
  try {
    localStorage.setItem(PROTECTION_SETUPS_KEY, JSON.stringify(normalized))
    // Keep the pre-setup keys as a compatibility mirror for older builds. They
    // always contain one complete ruler: the active setup, never merged rules.
    localStorage.setItem(FOCUS_APPS_KEY, JSON.stringify({
      focusApps: active.focusApps,
      distractionApps: active.distractionApps,
      focusDomains: active.focusDomains,
      distractionDomains: active.distractionDomains,
    }))
    localStorage.setItem(STRICT_MODE_KEY, String(active.strictMode))
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
    return getActiveProtectionSetup(loadProtectionSetups()).strictMode
  } catch {
    return false
  }
}

export function saveStrictMode(enabled) {
  const next = Boolean(enabled)
  saveProtectionSetups(updateActiveProtectionSetup(loadProtectionSetups(), { strictMode: next }))
  return next
}

// ── Output evidence folder ──────────────────────────────────────────────────
// The project folder a session's work lives in. Only the path is stored; the
// companion reads metadata from it during a session and never its contents.
const OUTPUT_FOLDER_KEY = 'eudaimonia_output_folder'

export function loadOutputFolder() {
  try { return localStorage.getItem(OUTPUT_FOLDER_KEY) || '' } catch { return '' }
}

export function saveOutputFolder(path) {
  const next = String(path || '')
  try { localStorage.setItem(OUTPUT_FOLDER_KEY, next) } catch {}
  return next
}

/// Opens the native folder picker. Returns '' outside the native app, where no
/// such dialog exists — the feature is simply unavailable in a browser.
export async function pickOutputFolder() {
  const invoke = window.__TAURI__?.core?.invoke
  if (!invoke) return ''
  try {
    return (await invoke('pick_output_folder')) || ''
  } catch {
    return ''
  }
}

// ── Intent contract provider ────────────────────────────────────────────────
// Which engine turns a goal sentence into session expectations. Switchable at
// any time; the app behaves identically whichever is chosen, only better or
// worse informed.
const CONTRACT_KEY = 'eudaimonia_contract_settings'

const CONTRACT_DEFAULTS = {
  provider: 'keywords',                    // off by default: no network, no key
  localModel: 'qwen2.5:3b',
  localEndpoint: 'http://127.0.0.1:11434',
}

export function loadContractSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONTRACT_KEY) || '{}')
    const { apiKey: _legacyKey, ...safe } = raw
    return { ...CONTRACT_DEFAULTS, ...safe }
  } catch {
    return { ...CONTRACT_DEFAULTS }
  }
}

export function saveContractSettings(patch) {
  const next = { ...loadContractSettings(), ...patch }
  try { localStorage.setItem(CONTRACT_KEY, JSON.stringify(next)) } catch {}
  return next
}

// One-shot compatibility bridge for versions that kept the key in WebView
// storage. It is removed only after the native Keychain write succeeds.
export function loadLegacyCloudApiKey() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONTRACT_KEY) || '{}')
    const key = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : ''
    if (!key) return ''
    return key
  } catch { return '' }
}

export function clearLegacyCloudApiKey() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONTRACT_KEY) || '{}')
    delete raw.apiKey
    localStorage.setItem(CONTRACT_KEY, JSON.stringify(raw))
  } catch {}
}
