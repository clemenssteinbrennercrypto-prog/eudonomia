// An explicitly separate derived ruler over the exact ledger accumulators.
// Ledger/schema V1 and camera generation V2 are not this metric's version.
// No V1 contributions, phase weights or saved session fields are rewritten.
import { buildFocusPeriod, localDayKey } from './focusMetric'
import { normalizeFocusScoreSchedule } from './focusScoreSchedule'

export const FOCUS_METRIC_V2 = Object.freeze({
  version: 2,
  referenceMinutes: 120,
  referenceTimeCredit: 0.9,
  consistencyWeight: 0.25,
})

export function calculateFocusV2({ measuredSeconds, scoreSum } = {}) {
  if (!Number.isFinite(measuredSeconds) || measuredSeconds <= 0 ||
    !Number.isFinite(scoreSum) || scoreSum < 0 || scoreSum > measuredSeconds * 100) return null
  const attention = scoreSum / measuredSeconds
  const minutes = measuredSeconds / 60
  // Concave, bounded and continuous: 120 minutes earn 90% of the time credit.
  // At fixed time, quality is linear; at fixed quality, time has diminishing
  // returns. Appending zero-attention time cannot improve the result.
  const timeCredit = -Math.expm1(Math.log1p(-FOCUS_METRIC_V2.referenceTimeCredit) * minutes / FOCUS_METRIC_V2.referenceMinutes)
  const rawScore = attention * timeCredit
  return { metricVersion: 2, rawScore, score: Math.round(rawScore), attention, timeCredit }
}

export function calculateFocusConsistency(days, schedule, now) {
  const plans = normalizeFocusScoreSchedule(schedule).plans
  const todayKey = localDayKey(now)
  let eligibleDays = 0
  let completedDays = 0
  let unknownDays = 0
  for (const day of days) {
    if (!todayKey || day.key > todayKey || day.status === 'future') continue
    const plan = plans.filter(item => item.effectiveFrom <= day.key).at(-1)
    if (!plan || !plan.workdays.includes(day.date.getDay())) continue
    // Today's absence is not a missed day. A real measured zero IS a
    // completed measurement; its poor quality is already in the daily score.
    if (day.key === todayKey && day.status !== 'measured') continue
    if (day.status === 'unmeasured' || day.status === 'different_generation') {
      unknownDays += 1
      continue
    }
    eligibleDays += 1
    if (day.status === 'measured') completedDays += 1
  }
  const fraction = eligibleDays > 0 ? completedDays / eligibleDays : null
  return {
    eligibleDays, completedDays, unknownDays,
    fraction,
    percent: fraction == null ? null : Math.round(fraction * 100),
    factor: fraction == null ? 1 : 1 - FOCUS_METRIC_V2.consistencyWeight * (1 - fraction),
  }
}

export function buildFocusPeriodV2(ledger, options = {}) {
  // Reuse the proven validation, five-minute eligibility and camera-generation
  // boundaries. The V1 composite itself never enters a V2 calculation.
  const requestedNow = new Date(options.now ?? Date.now())
  const now = Number.isNaN(requestedNow.getTime()) ? new Date() : requestedNow
  const v1 = buildFocusPeriod(ledger, { ...options, now })
  const days = v1.days.map(day => day.status === 'measured'
    ? { ...day, ...calculateFocusV2(day) }
    : { ...day, metricVersion: 2 })
  const measured = days.filter(day => day.status === 'measured')
  const dailyAverage = measured.length ? measured.reduce((sum, day) => sum + day.rawScore, 0) / measured.length : null
  const consistency = calculateFocusConsistency(days, options.schedule, now)
  const rawScore = dailyAverage == null ? null : dailyAverage * (v1.range === 'day' ? 1 : consistency.factor)
  const todayKey = localDayKey(now)
  return {
    ...v1,
    metricVersion: 2,
    calculationSource: 'qualified_ledger_accumulators_v1',
    days,
    today: days.find(day => day.key === todayKey) ?? null,
    rawScore,
    score: rawScore == null ? null : Math.round(rawScore),
    dailyAverage,
    consistency,
    timeCredit: measured.length ? measured.reduce((sum, day) => sum + day.timeCredit, 0) / measured.length : null,
    // Never compare a V2 composite with a V1 baseline. Period consistency
    // also makes a daily median the wrong comparator for weeks or months.
    baseline: null,
  }
}

export function buildVersionedFocusPeriod(ledger, options = {}) {
  return options.metricVersion === 1 ? buildFocusPeriod(ledger, options) : buildFocusPeriodV2(ledger, options)
}
