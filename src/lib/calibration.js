// Personal calibration — what YOUR history says about how you work.
//
// This is deliberately statistics, not AI. "Your writing sessions produce more
// before 11:00" is a mean over your own sessions; asking a language model would
// get you an invented number that sounds the same. The model's job is reading
// open-ended language; the numbers come from measurement.
//
// The governing rule here is refusal: with four sessions there is nothing
// honest to say about your best hours, and saying it anyway is how a tool
// becomes a horoscope. Every claim carries the sample it rests on, and no claim
// is made below the thresholds below.

import { isComparableFocusGeneration, sessionFocusMeasurement, sessionFocusPct } from './historyTrend'

/** Nothing at all is claimed under this many usable sessions. */
export const MIN_SESSIONS = 8
/** A bucket (time of day, duration) needs this many before it can be compared. */
export const MIN_PER_BUCKET = 3
/** Two buckets must differ by at least this much to be called a difference. */
export const MIN_MEANINGFUL_GAP_PCT = 12

const PARTS_OF_DAY = [
  { id: 'early',     label: 'early morning', from: 6,  to: 9  },
  { id: 'morning',   label: 'late morning',  from: 9,  to: 12 },
  { id: 'midday',    label: 'midday',        from: 12, to: 15 },
  { id: 'afternoon', label: 'afternoon',     from: 15, to: 18 },
  { id: 'evening',   label: 'evening',       from: 18, to: 22 },
  { id: 'night',     label: 'late night',    from: 22, to: 6  },
]

function partOfDay(hour) {
  return PARTS_OF_DAY.find(p =>
    p.from < p.to ? hour >= p.from && hour < p.to : hour >= p.from || hour < p.to
  ) || PARTS_OF_DAY[0]
}

/** A session only counts if focus was genuinely measured and it ran long enough
 *  to mean anything. A 20-second session is noise, not evidence. */
export function isUsable(session) {
  if (!session) return false
  if (!isComparableFocusGeneration(session)) return false
  // Calibration makes cross-session claims. A known tracking fault makes the
  // whole session unreliable evidence even when an earlier partial span was
  // valid enough to display in that session's own debrief.
  if (session.trackingFaulted) return false
  if (!(session.actualSeconds > 120)) return false
  const measurement = sessionFocusMeasurement(session)
  return measurement?.measuredSeconds > 120 && Number.isFinite(session.timestamp)
}

export function focusPct(session) {
  return sessionFocusPct(session)
}

/** Sessions are stamped when they end, so the start is where the work happened. */
export function startHour(session) {
  const startMs = session.timestamp - (session.actualSeconds || 0) * 1000
  return new Date(startMs).getHours()
}

function mean(values) {
  if (!values.length) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function median(values) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Best and worst part of day, but only where both rest on enough sessions and
 *  actually differ. Ranking six buckets of two sessions each is astrology. */
export function timeOfDayFit(sessions) {
  const buckets = new Map()
  for (const s of sessions) {
    const part = partOfDay(startHour(s))
    const pct = focusPct(s)
    if (pct == null) continue
    if (!buckets.has(part.id)) buckets.set(part.id, { part, values: [] })
    buckets.get(part.id).values.push(pct)
  }

  const ranked = [...buckets.values()]
    .filter(b => b.values.length >= MIN_PER_BUCKET)
    .map(b => ({ id: b.part.id, label: b.part.label, focusPct: Math.round(mean(b.values)), n: b.values.length }))
    .sort((a, b) => b.focusPct - a.focusPct)

  if (ranked.length < 2) return { ranked, best: null, worst: null }
  const best = ranked[0]
  const worst = ranked[ranked.length - 1]
  const meaningful = best.focusPct - worst.focusPct >= MIN_MEANINGFUL_GAP_PCT
  return { ranked, best: meaningful ? best : null, worst: meaningful ? worst : null }
}

/** Do you plan more than fits? Compares planned minutes with what actually ran.
 *  Sessions that hit their planned length exactly are excluded from the ratio —
 *  they ended because the timer ended, so they say nothing about your estimate. */
export function planningFit(sessions) {
  const pairs = sessions
    .filter(s => s.plannedDuration > 0 && s.actualSeconds > 0 && !s.completed)
    .map(s => ({ planned: s.plannedDuration, actual: s.actualSeconds / 60 }))

  if (pairs.length < MIN_PER_BUCKET) return null
  const plannedMed = median(pairs.map(p => p.planned))
  const actualMed = median(pairs.map(p => p.actual))
  if (!plannedMed || !actualMed) return null

  return {
    n: pairs.length,
    plannedMedian: Math.round(plannedMed),
    actualMedian: Math.round(actualMed),
    ratio: actualMed / plannedMed,
  }
}

/** Which planned length actually works for you — does 90 minutes really beat
 *  50, or do you just sit there longer? */
export function durationFit(sessions) {
  const buckets = new Map()
  for (const s of sessions) {
    const planned = s.plannedDuration
    const pct = focusPct(s)
    if (!planned || pct == null) continue
    if (!buckets.has(planned)) buckets.set(planned, [])
    buckets.get(planned).push(pct)
  }
  const ranked = [...buckets.entries()]
    .filter(([, v]) => v.length >= MIN_PER_BUCKET)
    .map(([minutes, v]) => ({ minutes, focusPct: Math.round(mean(v)), n: v.length }))
    .sort((a, b) => b.focusPct - a.focusPct)

  if (ranked.length < 2) return { ranked, best: null }
  const best = ranked[0]
  const longest = [...ranked].sort((a, b) => b.minutes - a.minutes)[0]
  return {
    ranked,
    best,
    // Worth saying only when a shorter block genuinely beats a longer one.
    shorterIsBetter:
      longest.minutes > best.minutes && longest.focusPct + MIN_MEANINGFUL_GAP_PCT <= best.focusPct
        ? { best, longest }
        : null,
  }
}

/** Rate of sessions the user themselves called a success. The only ground truth
 *  in the system — everything else is inference. */
export function outcomeFit(sessions) {
  const rated = sessions.filter(s => s.goalOutcome)
  if (rated.length < MIN_PER_BUCKET) return null
  const hit = rated.filter(s => s.goalOutcome === 'yes').length
  return { n: rated.length, hitRate: Math.round((hit / rated.length) * 100) }
}

/**
 * The whole picture. Returns `ready: false` — with how many sessions are still
 * needed — rather than guessing from thin data.
 */
export function calibrate(sessions = []) {
  const usable = sessions.filter(isUsable)
  if (usable.length < MIN_SESSIONS) {
    return {
      ready: false,
      sessionsAnalysed: usable.length,
      needMore: MIN_SESSIONS - usable.length,
      insights: [],
    }
  }

  const time = timeOfDayFit(usable)
  const planning = planningFit(usable)
  const duration = durationFit(usable)
  const outcome = outcomeFit(usable)
  const insights = []

  if (time.best && time.worst) {
    insights.push({
      kind: 'time_of_day',
      text: `Your ${time.best.label} sessions average ${time.best.focusPct}% focused, against ${time.worst.focusPct}% in the ${time.worst.label}.`,
      n: time.best.n + time.worst.n,
    })
  }

  if (planning && planning.ratio < 0.7) {
    insights.push({
      kind: 'planning',
      text: `You plan ${planning.plannedMedian} minutes but typically run ${planning.actualMedian}. Planning the length you actually work would make the number mean something.`,
      n: planning.n,
    })
  }

  if (duration?.shorterIsBetter) {
    const { best, longest } = duration.shorterIsBetter
    insights.push({
      kind: 'duration',
      text: `${best.minutes}-minute sessions hold ${best.focusPct}% focus; your ${longest.minutes}-minute ones drop to ${longest.focusPct}%. The longer block buys time, not attention.`,
      n: best.n + longest.n,
    })
  }

  if (outcome) {
    insights.push({
      kind: 'outcome',
      text: `You reach the goal you set in ${outcome.hitRate}% of sessions you rated.`,
      n: outcome.n,
    })
  }

  return {
    ready: true,
    sessionsAnalysed: usable.length,
    needMore: 0,
    timeOfDay: time,
    planning,
    duration,
    outcome,
    insights,
  }
}

/** One line for the home screen: when to start, based on measurement. */
export function suggestNextSession(sessions = [], now = new Date()) {
  const c = calibrate(sessions)
  if (!c.ready || !c.timeOfDay?.best) return null
  const best = c.timeOfDay.best
  const part = PARTS_OF_DAY.find(p => p.id === best.id)
  if (!part) return null

  const hour = now.getHours()
  const inWindow = part.from < part.to
    ? hour >= part.from && hour < part.to
    : hour >= part.from || hour < part.to

  return {
    partId: best.id,
    label: part.label,
    focusPct: best.focusPct,
    n: best.n,
    inWindow,
    text: inWindow
      ? `This is your strongest window — ${best.focusPct}% average across ${best.n} sessions.`
      : `Your strongest window is the ${part.label} (${best.focusPct}% across ${best.n} sessions).`,
  }
}
