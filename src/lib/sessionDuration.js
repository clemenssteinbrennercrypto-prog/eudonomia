export const UNLIMITED_BLOCKING_LEASE_SECONDS = 90

export function hasTimeLimit(duration) {
  return Number.isFinite(duration) && duration > 0
}

export function isCustomDuration(duration, presets) {
  return hasTimeLimit(duration) && !presets.includes(duration)
}

export function sessionTimerSeconds(duration, elapsedSeconds) {
  const elapsed = Math.max(0, Number(elapsedSeconds) || 0)
  if (!hasTimeLimit(duration)) return Math.floor(elapsed)
  return Math.max(0, Math.ceil(duration * 60 - elapsed))
}

export function shouldAutoEndSession(duration, timerSeconds) {
  return hasTimeLimit(duration) && timerSeconds === 0
}

export function blockingLeaseSeconds(duration, timerSeconds) {
  return hasTimeLimit(duration)
    ? Math.max(0, Number(timerSeconds) || 0)
    : UNLIMITED_BLOCKING_LEASE_SECONDS
}

export function durationFromSetup(setup, fallback = 30) {
  if (!setup || !Object.hasOwn(setup, 'duration')) return fallback
  return setup.duration
}

export function durationFromSession(session, fallback = 30) {
  if (!session || !Object.hasOwn(session, 'plannedDuration')) return fallback
  return session.plannedDuration
}
