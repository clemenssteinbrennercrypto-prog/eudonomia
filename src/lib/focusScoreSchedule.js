// A dated workday plan is context for consistency, never camera evidence.
// Editing it must not rewrite yesterday's expectations.
import { localDayKey } from './focusMetric'

export const FOCUS_SCORE_SCHEDULE_KEY = 'eudaimonia_focus_schedule_v1'
export const DEFAULT_FOCUS_WORKDAYS = Object.freeze([1, 2, 3, 4, 5])

function validDayKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const date = new Date(`${key}T12:00:00`)
  return localDayKey(date) === key
}

function validWorkdays(days) {
  return Array.isArray(days) && days.length > 0 && days.length <= 7 &&
    days.every(day => Number.isInteger(day) && day >= 0 && day <= 6) &&
    new Set(days).size === days.length
}

export function normalizeFocusScoreSchedule(value) {
  if (value?.version !== 1 || !Array.isArray(value.plans)) return { version: 1, plans: [] }
  const plans = new Map()
  for (const plan of value.plans) {
    if (!validDayKey(plan?.effectiveFrom) || !validWorkdays(plan?.workdays)) continue
    plans.set(plan.effectiveFrom, { effectiveFrom: plan.effectiveFrom, workdays: [...plan.workdays].sort() })
  }
  return { version: 1, plans: [...plans.values()].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)) }
}

export function scheduleForDay(schedule, dayKey) {
  return normalizeFocusScoreSchedule(schedule).plans.filter(plan => plan.effectiveFrom <= dayKey).at(-1) ?? null
}

export function changeFocusScoreSchedule(schedule, workdays, now = Date.now()) {
  if (!validWorkdays(workdays)) throw new Error('Choose at least one workday.')
  const current = normalizeFocusScoreSchedule(schedule)
  const effective = new Date(now)
  if (Number.isNaN(effective.getTime())) throw new Error('The workday plan needs a valid date.')
  // The initial plan starts today; subsequent edits can only affect tomorrow.
  if (current.plans.length > 0) effective.setDate(effective.getDate() + 1)
  const effectiveFrom = localDayKey(effective)
  return normalizeFocusScoreSchedule({
    version: 1,
    plans: [...current.plans.filter(plan => plan.effectiveFrom < effectiveFrom), { effectiveFrom, workdays }],
  })
}

export function loadFocusScoreSchedule() {
  try { return normalizeFocusScoreSchedule(JSON.parse(localStorage.getItem(FOCUS_SCORE_SCHEDULE_KEY))) }
  catch { return { version: 1, plans: [] } }
}

export function saveFocusScoreSchedule(schedule) {
  const normalized = normalizeFocusScoreSchedule(schedule)
  // Let the caller display a failed save; an unsaved plan is not authoritative.
  localStorage.setItem(FOCUS_SCORE_SCHEDULE_KEY, JSON.stringify(normalized))
  return normalized
}
