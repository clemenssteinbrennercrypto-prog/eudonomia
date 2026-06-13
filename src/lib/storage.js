// ── Session History Storage ───────────────────────────────────────────────────
// Persists sessions to localStorage under key 'eudaimonia_sessions'
// Max 100 sessions kept (oldest purged first)

const STORAGE_KEY = 'eudaimonia_sessions'
const MAX_SESSIONS = 100

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
