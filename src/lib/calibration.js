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

import { comparableSessions, sessionAverageFocus, sessionFocusMeasurement } from './historyTrend'
import { summarizeSessionAlignment } from './sessionIntent'

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
  // Calibration makes cross-session claims. A known tracking fault makes the
  // whole session unreliable evidence even when an earlier partial span was
  // valid enough to display in that session's own debrief.
  if (session.trackingFaulted) return false
  if (!(session.actualSeconds > 120)) return false
  const measurement = sessionFocusMeasurement(session)
  return measurement?.measuredSeconds > 120 && Number.isFinite(session.timestamp)
}

// Patterns compare the same number the screens display, or the two would
// disagree about what "82%" refers to.
export function focusPct(session) {
  return sessionAverageFocus(session)
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
    if (!buckets.has(part.id)) buckets.set(part.id, { id: part.id, label: part.label, values: [], sessions: [] })
    const bucket = buckets.get(part.id)
    bucket.values.push(pct)
    bucket.sessions.push(s)
  }
  return rankBuckets(buckets)
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
 *  in the system — everything else is inference. Deliberately takes any subset
 *  of sessions, not just the whole qualified history: Patterns crosses this
 *  against each condition bucket below to answer "outcome vs condition", not
 *  just "outcome overall". */
export function outcomeFit(sessions) {
  const rated = sessions.filter(s => s.goalOutcome)
  if (rated.length < MIN_PER_BUCKET) return null
  const hit = rated.filter(s => s.goalOutcome === 'yes').length
  return { n: rated.length, hitRate: Math.round((hit / rated.length) * 100) }
}

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Every *Fit function below shares one shape — {ranked, best, worst} — and one
// rule: a bucket needs MIN_PER_BUCKET sessions to be ranked at all, and best/
// worst are only ever named when they clear MIN_MEANINGFUL_GAP_PCT. Two people
// who both worked out patterns that turned out to be noise built this the hard
// way; this helper exists so every new axis inherits the same refusal for free
// instead of re-deriving it.
//
// Each ranked entry also carries its raw `sessions` — Patterns.jsx crosses
// these against outcomeFit() to answer "goal outcome vs condition", the
// priority the spec asks for, not just "focus % vs condition".
function rankBuckets(buckets) {
  const ranked = [...buckets.values()]
    .filter(b => b.values.length >= MIN_PER_BUCKET)
    .map(b => ({ id: b.id, label: b.label, focusPct: Math.round(mean(b.values)), n: b.values.length, sessions: b.sessions }))
    .sort((a, b) => b.focusPct - a.focusPct)
  if (ranked.length < 2) return { ranked, best: null, worst: null }
  const best = ranked[0]
  const worst = ranked[ranked.length - 1]
  const meaningful = best.focusPct - worst.focusPct >= MIN_MEANINGFUL_GAP_PCT
  return { ranked, best: meaningful ? best : null, worst: meaningful ? worst : null }
}

/** Sessions are stamped at end; the start moment is where the work happened —
 *  same reasoning as startHour, one level up to the calendar day. */
function startDate(session) {
  return new Date(session.timestamp - (session.actualSeconds || 0) * 1000)
}

/** Does the day of the week predict your focus? */
export function weekdayFit(sessions) {
  const buckets = new Map()
  for (const s of sessions) {
    const pct = focusPct(s)
    if (pct == null) continue
    const day = startDate(s).getDay()
    if (!buckets.has(day)) buckets.set(day, { id: day, label: WEEKDAY_LABELS[day], values: [], sessions: [] })
    const bucket = buckets.get(day)
    bucket.values.push(pct)
    bucket.sessions.push(s)
  }
  return rankBuckets(buckets)
}

/** Does the workspace (and which revision of its setup) predict your focus? */
export function workspaceFit(sessions) {
  const buckets = new Map()
  for (const s of sessions) {
    const ws = s.workspace
    const pct = focusPct(s)
    if (!ws?.id || pct == null) continue
    const key = `${ws.id}:${ws.revision ?? 0}`
    if (!buckets.has(key)) buckets.set(key, { id: key, label: ws.name || ws.id, values: [], sessions: [] })
    const bucket = buckets.get(key)
    bucket.values.push(pct)
    bucket.sessions.push(s)
  }
  return rankBuckets(buckets)
}

/** Does self-reported energy at the start predict focus? Energy is still never
 *  a scoring input (see sessionAnalysis.js) — this only asks whether it
 *  correlates with the measured outcome after the fact. */
export function energyFit(sessions) {
  const buckets = new Map()
  for (const s of sessions) {
    const pct = focusPct(s)
    if (!s.energyLevel || pct == null) continue
    if (!buckets.has(s.energyLevel)) buckets.set(s.energyLevel, { id: s.energyLevel, label: `${s.energyLevel} energy`, values: [], sessions: [] })
    const bucket = buckets.get(s.energyLevel)
    bucket.values.push(pct)
    bucket.sessions.push(s)
  }
  return rankBuckets(buckets)
}

/** Do sessions with an early drift-risk cue end up different from ones
 *  without? Compares the two groups' overall focus, not just the flagged
 *  stretch — a real answer needs the whole session as context. */
export function driftRecoveryFit(sessions) {
  const buckets = new Map([
    [true, { id: true, label: 'sessions with drift-risk cues', values: [], sessions: [] }],
    [false, { id: false, label: 'sessions without drift-risk cues', values: [], sessions: [] }],
  ])
  for (const s of sessions) {
    const pct = focusPct(s)
    if (pct == null) continue
    const bucket = buckets.get((s.preDriftEvents || 0) > 0)
    bucket.values.push(pct)
    bucket.sessions.push(s)
  }
  return rankBuckets(buckets)
}

/** Sessions with actually-observed activity, bucketed by whether that activity
 *  mostly matched the stated goal. Requires real observed seconds — a
 *  near-empty activity log is not evidence either way, see MIN_OBSERVED_SECONDS
 *  below (kept local: this is the only place in calibration.js that reads
 *  activityAlignment). */
const MIN_OBSERVED_SECONDS_FOR_PATTERN = 60

function alignmentBand(session) {
  const alignment = summarizeSessionAlignment(session.activityAlignment, session.actualSeconds || 0)
  if (alignment.observedSeconds < MIN_OBSERVED_SECONDS_FOR_PATTERN || alignment.alignedPct == null) return null
  return alignment.alignedPct >= 70 ? 'aligned' : 'drifted'
}

export function activityAlignmentFit(sessions) {
  const buckets = new Map([
    ['aligned', { id: 'aligned', label: 'activity mostly matched the goal', values: [], sessions: [] }],
    ['drifted', { id: 'drifted', label: 'activity drifted off the goal', values: [], sessions: [] }],
  ])
  for (const s of sessions) {
    const band = alignmentBand(s)
    const pct = focusPct(s)
    if (!band || pct == null) continue
    const bucket = buckets.get(band)
    bucket.values.push(pct)
    bucket.sessions.push(s)
  }
  return rankBuckets(buckets)
}

/** Sessions with a watched output folder, bucketed by whether anything
 *  actually changed. Null (folder not watched) is excluded rather than
 *  treated as "no output" — those are different situations. */
function hadOutputChange(session) {
  const evidence = session.outputEvidence
  if (!evidence?.watched) return null
  return ((evidence.filesChanged || 0) + (evidence.filesCreated || 0) + (evidence.commits || 0)) > 0
}

export function outputEvidenceFit(sessions) {
  const buckets = new Map([
    [true, { id: true, label: 'the watched folder changed', values: [], sessions: [] }],
    [false, { id: false, label: 'the watched folder did not change', values: [], sessions: [] }],
  ])
  for (const s of sessions) {
    const had = hadOutputChange(s)
    const pct = focusPct(s)
    if (had == null || pct == null) continue
    const bucket = buckets.get(had)
    bucket.values.push(pct)
    bucket.sessions.push(s)
  }
  return rankBuckets(buckets)
}

// One entry per Patterns axis: how to compute it and how to phrase it as one
// insight sentence. `calibrate()` runs every entry and keeps whichever ones
// clear their refusal bar; Overview shows only the single strongest, Patterns
// shows all of them plus every axis that did NOT clear the bar (as an honest
// "not enough data" state) — see analytics/Patterns.jsx.
const INSIGHT_DEFINITIONS = [
  {
    kind: 'time_of_day',
    compute: timeOfDayFit,
    describe: (r) => r.best && r.worst
      ? { text: `Your ${r.best.label} sessions average ${r.best.focusPct}% focused, against ${r.worst.focusPct}% in the ${r.worst.label}.`, n: r.best.n + r.worst.n }
      : null,
  },
  {
    kind: 'weekday',
    compute: weekdayFit,
    describe: (r) => r.best && r.worst
      ? { text: `Your ${r.best.label}s average ${r.best.focusPct}% focused, against ${r.worst.focusPct}% on ${r.worst.label}s.`, n: r.best.n + r.worst.n }
      : null,
  },
  {
    kind: 'planning',
    compute: planningFit,
    describe: (p) => p && p.ratio < 0.7
      ? { text: `You plan ${p.plannedMedian} minutes but typically run ${p.actualMedian}. Planning the length you actually work would make the number mean something.`, n: p.n }
      : null,
  },
  {
    kind: 'duration',
    compute: durationFit,
    describe: (d) => d?.shorterIsBetter
      ? { text: `${d.shorterIsBetter.best.minutes}-minute sessions hold ${d.shorterIsBetter.best.focusPct}% focus; your ${d.shorterIsBetter.longest.minutes}-minute ones drop to ${d.shorterIsBetter.longest.focusPct}%. The longer block buys time, not attention.`, n: d.shorterIsBetter.best.n + d.shorterIsBetter.longest.n }
      : null,
  },
  {
    kind: 'workspace',
    compute: workspaceFit,
    describe: (r) => r.best && r.worst
      ? { text: `${r.best.label} sessions average ${r.best.focusPct}% focused, against ${r.worst.focusPct}% in ${r.worst.label}.`, n: r.best.n + r.worst.n }
      : null,
  },
  {
    kind: 'energy',
    compute: energyFit,
    describe: (r) => r.best && r.worst
      ? { text: `Your ${r.best.label} sessions average ${r.best.focusPct}% focused, against ${r.worst.focusPct}% at ${r.worst.label}.`, n: r.best.n + r.worst.n }
      : null,
  },
  {
    kind: 'drift_recovery',
    compute: driftRecoveryFit,
    describe: (r) => r.best && r.worst
      ? { text: `Your ${r.best.label} average ${r.best.focusPct}% focused, against ${r.worst.focusPct}% for ${r.worst.label}.`, n: r.best.n + r.worst.n }
      : null,
  },
  {
    kind: 'activity_alignment',
    compute: activityAlignmentFit,
    describe: (r) => r.best && r.worst
      ? { text: `Sessions where ${r.best.label} average ${r.best.focusPct}% focused, against ${r.worst.focusPct}% when ${r.worst.label}.`, n: r.best.n + r.worst.n }
      : null,
  },
  {
    kind: 'output_evidence',
    compute: outputEvidenceFit,
    describe: (r) => r.best && r.worst
      ? { text: `Sessions where ${r.best.label} average ${r.best.focusPct}% focused, against ${r.worst.focusPct}% when ${r.worst.label}.`, n: r.best.n + r.worst.n }
      : null,
  },
  {
    kind: 'outcome',
    compute: outcomeFit,
    describe: (o) => o
      ? { text: `You reach the goal you set in ${o.hitRate}% of sessions you rated.`, n: o.n }
      : null,
  },
]

/**
 * The whole picture. Returns `ready: false` — with how many sessions are still
 * needed — rather than guessing from thin data. Every axis in
 * INSIGHT_DEFINITIONS is computed and exposed by kind (Patterns reads the raw
 * result to show sample sizes even for axes that didn't clear the refusal
 * bar); `insights` carries only the ones that did.
 */
export function calibrate(sessions = []) {
  // Patterns rest on one ruler: narrow to the newest generation present before
  // any comparison, so a camera switch restarts the evidence rather than
  // blending two scales.
  const usable = comparableSessions(sessions).filter(isUsable)
  if (usable.length < MIN_SESSIONS) {
    return {
      ready: false,
      sessionsAnalysed: usable.length,
      needMore: MIN_SESSIONS - usable.length,
      insights: [],
    }
  }

  const results = {}
  const insights = []
  for (const def of INSIGHT_DEFINITIONS) {
    const computed = def.compute(usable)
    results[def.kind] = computed
    const described = def.describe(computed)
    if (described) insights.push({ kind: def.kind, ...described })
  }

  return {
    ready: true,
    sessionsAnalysed: usable.length,
    needMore: 0,
    timeOfDay: results.time_of_day,
    planning: results.planning,
    duration: results.duration,
    outcome: results.outcome,
    weekday: results.weekday,
    workspace: results.workspace,
    energy: results.energy,
    driftRecovery: results.drift_recovery,
    activityAlignment: results.activity_alignment,
    outputEvidence: results.output_evidence,
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
