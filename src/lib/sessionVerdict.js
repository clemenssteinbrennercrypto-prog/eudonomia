// The session verdict — did the work match the intention?
//
// The focus score says how attentive someone was. The contract says what the
// session was for. Neither answers the question people actually ask themselves
// afterwards: did I do the thing I sat down to do?
//
// That needs judgement rather than string matching, which is the one place a
// language model genuinely earns its cost here. It is also why the `keywords`
// provider returns NOTHING from this module instead of a cheap verdict: a
// keyword matcher cannot weigh "40 minutes in Figma" against "write the intro
// chapter", and a confident-sounding guess is worse than silence.
//
// ── buildVerdictInput() is the boundary, and it carries two jobs at once ────
//
// A raw session record is ~33,000 tokens, and ~92% of that is the per-second
// timeline — data a model cannot use and would be billed for. Aggregating
// first brings it to roughly 1,200 tokens: a ~27x cost difference, which is
// larger than the gap between the cheapest and the most expensive model.
//
// The fields dropped for cost are the same ones that carry private content:
// window titles (`label`), artifact names derived from titles (`byArtifact`),
// the watched folder path (`root`) and changed file names (`changedNames`).
// What survives is app names, bare hostnames, durations and counts.
//
// So: cost and privacy point the same way here. Do not "enrich" this payload
// without reading both test blocks in sessionVerdict.test.js first.

import { callModel, parseModelJson } from './modelClient'

/** Below this a session is noise, not evidence — same bar as calibration.js. */
export const MIN_SESSION_SECONDS = 120
/** Some activity must actually have been observed before judging alignment. */
export const MIN_OBSERVED_SECONDS = 60
/** Most of the time sits in a handful of places; the tail is noise and cost. */
export const MAX_ACTIVITIES = 6
/** A verdict runs after the session, so it may wait longer than a contract. */
export const VERDICT_TIMEOUT_MS = 20_000
/** Cost guard. The aggregated prompt is ~2-4k chars; anything near this cap
 *  means raw data leaked back in. A test asserts it. */
export const MAX_PROMPT_CHARS = 6_000

const MATCHED = ['yes', 'partly', 'no', 'unclear']
const KINDS = ['aligned', 'supportive', 'unclear', 'off_goal', 'distraction', 'blocked']

/** Hostname only. Never a path or query — "youtube.com", not the video. */
function hostOnly(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  return raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].slice(0, 60)
}

function appName(value) {
  return String(value || '').trim().slice(0, 40)
}

function nonNegative(value) {
  return Math.max(0, Math.round(Number(value) || 0))
}

/**
 * Where the time went, abstracted. Reads `app` and `domain` only.
 *
 * `label` is deliberately never read: it falls back to the window title, so it
 * is the field that would carry "thesis_intro_v3.docx" off the device.
 */
function abstractActivities(byActivity = {}) {
  return Object.values(byActivity || {})
    .filter(entry => entry && Number(entry.seconds) > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, MAX_ACTIVITIES)
    .map(entry => ({
      app: appName(entry.app),
      site: hostOnly(entry.domain),
      kind: KINDS.includes(entry.kind) ? entry.kind : 'unclear',
      minutes: Math.max(1, Math.round(Number(entry.seconds) / 60)),
    }))
    .filter(entry => entry.app || entry.site)
}

/**
 * Did anything move on disk. Counts only.
 *
 * `root` (the folder path) and `changedNames` (file names) are deliberately
 * never read — output.rs gathers them for the local end screen, not for a
 * model. A zeroed result is kept rather than dropped: "you watched a folder
 * and nothing changed" is a real signal.
 */
function abstractOutput(evidence) {
  if (!evidence || !evidence.watched) return null
  return {
    filesChanged: nonNegative(evidence.filesChanged),
    filesCreated: nonNegative(evidence.filesCreated),
    kbAdded: Math.round((Number(evidence.bytesAdded) || 0) / 1024),
    commits: nonNegative(evidence.commits),
    linesAdded: nonNegative(evidence.linesAdded),
    linesRemoved: nonNegative(evidence.linesRemoved),
  }
}

/** What the contract said to expect. Finally puts output.plausibleRange,
 *  unit and type to work — they were produced and validated but never read. */
function abstractExpectation(contract) {
  if (!contract || typeof contract !== 'object') return null
  const expectation = {
    tools: (contract.expectedTools || []).slice(0, 8),
    supporting: (contract.supporting || []).slice(0, 8),
    outputType: contract.output?.type || '',
    unit: contract.output?.unit || '',
    range: Array.isArray(contract.output?.plausibleRange) ? contract.output.plausibleRange : null,
  }
  const useful = expectation.tools.length || expectation.supporting.length || expectation.range
  return useful ? expectation : null
}

/**
 * Compress one session record into what a model needs — or return null when
 * there is nothing honest to judge. Refusing here is the point: no goal means
 * no yardstick, a 40-second session means no evidence, and a verdict invented
 * from either is exactly the horoscope this app is not.
 */
export function buildVerdictInput(session) {
  if (!session || typeof session !== 'object') return null

  const intent = session.sessionIntent || {}
  const goal = [intent.task, intent.goal].filter(Boolean).join(' — ').trim().slice(0, 300)
  if (!goal) return null

  const actualSeconds = Number(session.actualSeconds) || 0
  if (actualSeconds < MIN_SESSION_SECONDS) return null

  const alignment = session.activityAlignment || {}
  const secondsByKind = alignment.secondsByKind || {}
  const observedSeconds = Object.values(secondsByKind)
    .reduce((sum, value) => sum + (Number(value) || 0), 0)

  const output = abstractOutput(session.outputEvidence)
  const activities = abstractActivities(alignment.byActivity)

  // Nothing was watched and nothing was observed: there is no evidence of what
  // happened, only of how long it lasted. Say nothing.
  if (observedSeconds < MIN_OBSERVED_SECONDS && !output) return null

  // Focus is reported only when it was actually measured. A faulted camera
  // means the number is absent, not zero (see AGENTS.md invariant 8).
  const focusMeasured = session.trackingFaulted !== true
    && session.scoreMeasured !== false
    && Number.isFinite(session.focusedSeconds)

  return {
    goal,
    plannedMinutes: nonNegative(session.plannedDuration),
    actualMinutes: Math.round(actualSeconds / 60),
    focusPct: focusMeasured ? Math.round((session.focusedSeconds / actualSeconds) * 100) : null,
    observedMinutes: Math.round(observedSeconds / 60),
    activities,
    output,
    expected: abstractExpectation(session.sessionContract),
  }
}

export function buildVerdictPrompt(input) {
  const lines = [
    'A person finished a focused work session. Judge whether what they did',
    'matched what they set out to do.',
    '',
    `Their stated goal: "${input.goal}"`,
    `Planned ${input.plannedMinutes} min, ran ${input.actualMinutes} min.`,
  ]

  if (input.focusPct != null) {
    lines.push(`Attention: focused ${input.focusPct}% of that time.`)
  }

  if (input.expected) {
    const parts = []
    if (input.expected.tools.length) parts.push(`expected tools: ${input.expected.tools.join(', ')}`)
    if (input.expected.range) {
      parts.push(`a plausible result is ${input.expected.range[0]}-${input.expected.range[1]} ${input.expected.unit || 'units'}`)
    }
    if (parts.length) lines.push(`For this kind of goal, ${parts.join('; ')}.`)
  }

  if (input.activities.length) {
    lines.push('', 'Where the time went:')
    for (const entry of input.activities) {
      const where = [entry.app, entry.site].filter(Boolean).join(' / ')
      lines.push(`  ${entry.minutes} min — ${where} (classified: ${entry.kind})`)
    }
  }

  if (input.output) {
    const o = input.output
    lines.push('', `Files in the nominated folder: ${o.filesChanged} changed, ${o.filesCreated} created, ${o.kbAdded} KB added, ${o.commits} commits, +${o.linesAdded}/-${o.linesRemoved} lines.`)
  }

  lines.push(
    '',
    'Reply with JSON only, no commentary:',
    '{',
    '  "matched": "yes|partly|no|unclear",',
    '  "headline": "one short sentence the person reads first",',
    '  "reason": "two sentences at most, citing the evidence above",',
    '  "suggestion": "one concrete thing to change next session, or empty",',
    '  "confidence": "high|medium|low"',
    '}',
    '',
    'Be specific and honest. If the evidence is too thin to tell, say',
    '"unclear" rather than inventing a story. Do not flatter.'
  )

  return lines.join('\n')
}

/**
 * The boundary. Whatever the model returned, what leaves here is a usable
 * verdict or nothing — never a half-filled object for the UI to render.
 */
export function normalizeVerdict(raw, { source = 'local' } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const matched = MATCHED.includes(raw.matched) ? raw.matched : null
  const headline = String(raw.headline ?? '').trim().slice(0, 140)
  // A verdict with no verdict and no sentence is not a verdict.
  if (!matched || !headline) return null

  return {
    source,
    matched,
    headline,
    reason: String(raw.reason ?? '').trim().slice(0, 400),
    suggestion: String(raw.suggestion ?? '').trim().slice(0, 200),
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low',
  }
}

/**
 * Produce a verdict for a finished session, or null.
 *
 * Null is a first-class answer here and has three distinct causes, all of them
 * fine: the user has no model configured, the evidence is too thin, or the
 * model failed. The end screen renders nothing in every case — an absent
 * verdict costs the user nothing, a fabricated one costs them trust.
 */
export async function deriveVerdict(session, { provider = 'keywords', timeoutMs, ...options } = {}) {
  if (provider !== 'local' && provider !== 'cloud') return null

  const input = buildVerdictInput(session)
  if (!input) return null

  const prompt = buildVerdictPrompt(input)
  const text = await callModel(prompt, {
    ...options,
    provider,
    timeoutMs: timeoutMs ?? VERDICT_TIMEOUT_MS,
  })

  return normalizeVerdict(parseModelJson(text), { source: provider })
}
