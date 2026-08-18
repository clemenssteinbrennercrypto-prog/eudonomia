// The session contract — one shape, several ways of producing it.
//
// A contract turns "finish the intro chapter" into expectations: which tools
// belong, which don't, what the output looks like. Three providers can produce
// it and every caller is blind to which one ran:
//
//   keywords  built-in profiles. Always available, instant, offline, dumb.
//   local     a model on this machine via Ollama. Private, no key, needs Ollama.
//   cloud     the Anthropic API. Best quality, needs a key, sends the goal line.
//
// Three rules make switching safe:
//
//  1. EVERY provider is async, so swapping one for another never changes a call
//     site.
//  2. EVERY provider falls back to keywords. A model that is slow, absent,
//     rate-limited or talking nonsense degrades the contract; it never breaks
//     the session.
//  3. EVERY result passes through normalizeContract(). Models return prose,
//     markdown fences, missing fields and invented types — none of that is
//     allowed past this boundary.
//
// Transport (the actual HTTP to Ollama / Anthropic) lives in modelClient.js so
// that this file and sessionVerdict.js cannot drift apart on timeouts, headers
// or model IDs.

import { deriveSessionIntent } from './sessionIntent'
import { PROVIDERS, callModel, parseModelJson, strList } from './modelClient'

export { PROVIDERS, parseModelJson }

/** A model gets this long before we stop waiting and use the keyword contract.
 *  Session start must never hang behind a model. */
const PROVIDER_TIMEOUT_MS = 12_000

const OUTPUT_TYPES = ['document', 'code', 'reading', 'design', 'admin', 'other']

const CONTRACT_KINDS = [
  'software', 'writing', 'research', 'design', 'planning', 'admin', 'general',
]

/**
 * The boundary. Whatever a provider returns, what leaves here is a valid
 * contract or nothing — never a half-filled object for the rest of the app to
 * trip over.
 */
export function normalizeContract(raw, { source = 'keywords', fallbackKind = 'general' } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const kind = CONTRACT_KINDS.includes(raw.kind) ? raw.kind : fallbackKind
  const outRaw = raw.output && typeof raw.output === 'object' ? raw.output : {}

  // A range is only useful if it is two ascending positive numbers.
  let plausibleRange = null
  const r = outRaw.plausibleRange ?? outRaw.plausible_range
  if (Array.isArray(r) && r.length === 2) {
    const lo = Number(r[0])
    const hi = Number(r[1])
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi >= lo) {
      plausibleRange = [Math.round(lo), Math.round(hi)]
    }
  }

  const expectedTools = strList(raw.expectedTools ?? raw.expected_tools)
  const supporting = strList(raw.supporting)
  const offGoal = strList(raw.offGoal ?? raw.off_goal)

  // A contract that expects nothing cannot judge anything.
  if (expectedTools.length === 0 && supporting.length === 0) return null

  return {
    source,
    restatedGoal: String(raw.restatedGoal ?? raw.restated_goal ?? '').trim().slice(0, 200),
    kind,
    expectedTools,
    supporting,
    offGoal,
    output: {
      type: OUTPUT_TYPES.includes(outRaw.type) ? outRaw.type : 'other',
      unit: String(outRaw.unit ?? '').trim().slice(0, 24),
      plausibleRange,
      artifactHint: String(outRaw.artifactHint ?? outRaw.artifact_hint ?? '').trim().slice(0, 64),
    },
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low',
  }
}

// ── The prompt ───────────────────────────────────────────────────────────────
// Only the goal line is sent. Never the activity log, window titles or file
// names — those are the sensitive part and they stay on the machine.
export function buildPrompt({ task = '', goal = '', tags = [] } = {}) {
  const stated = [task, goal, (tags || []).join(' ')].filter(Boolean).join(' — ')
  return `A person is starting a focused work session. This is what they wrote:

"${stated}"

Work out what that session needs. Reply with JSON only, no commentary:

{
  "restatedGoal": "one plain sentence",
  "kind": "software|writing|research|design|planning|admin|general",
  "expectedTools": ["app or site names they would work IN"],
  "supporting": ["app or site names they would legitimately consult"],
  "offGoal": ["sites that would mean they drifted"],
  "output": {
    "type": "document|code|reading|design|admin|other",
    "unit": "words|commits|pages|files|tasks",
    "plausibleRange": [low, high],
    "artifactHint": "a word likely to appear in the file or window title"
  },
  "confidence": "high|medium|low"
}

Use lowercase for tool and site names. If the goal is too vague to judge, say
so with "confidence": "low" rather than inventing specifics.`
}

/** Built-in profiles. No network, no key, always answers. */
async function keywordContract(intentInput) {
  const intent = deriveSessionIntent(intentInput)
  return normalizeContract(
    {
      restatedGoal: intent.goal || intent.task,
      kind: intent.primaryKind,
      expectedTools: intent.toolHints,
      supporting: intent.domainHints,
      offGoal: [],
      confidence: intent.confidence === 'medium' ? 'medium' : 'low',
    },
    { source: 'keywords', fallbackKind: intent.primaryKind }
  )
}

// Same goal, same contract — a model is asked once per distinct goal, not once
// per session.
const cache = new Map()
const cacheKey = (provider, input) =>
  `${provider}|${input?.task || ''}|${input?.goal || ''}|${(input?.tags || []).join(',')}`

export function clearContractCache() {
  cache.clear()
}

/**
 * Produce a contract. Never throws, never hangs, always returns something
 * usable — worst case the keyword contract, with `source` saying so.
 */
export async function deriveContract(intentInput, { provider = 'keywords', timeoutMs, ...options } = {}) {
  const chosen = PROVIDERS.includes(provider) ? provider : 'keywords'
  const key = cacheKey(chosen, intentInput)
  if (cache.has(key)) return cache.get(key)

  const fallback = await keywordContract(intentInput)

  if (chosen !== 'keywords') {
    const text = await callModel(buildPrompt(intentInput), {
      ...options,
      provider: chosen,
      timeoutMs: timeoutMs ?? PROVIDER_TIMEOUT_MS,
    })
    // A model that answered with nothing usable is a failed model, not a
    // reason to start the session without a contract.
    const contract = normalizeContract(parseModelJson(text), { source: chosen })
    if (contract) {
      cache.set(key, contract)
      return contract
    }
  }

  if (fallback) cache.set(key, fallback)
  return fallback
}
