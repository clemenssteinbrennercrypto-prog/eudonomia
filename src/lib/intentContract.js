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

import { deriveSessionIntent } from './sessionIntent'

export const PROVIDERS = ['keywords', 'local', 'cloud']

/** A model gets this long before we stop waiting and use the keyword contract.
 *  Session start must never hang behind a model. */
const PROVIDER_TIMEOUT_MS = 12_000

const OUTPUT_TYPES = ['document', 'code', 'reading', 'design', 'admin', 'other']

const CONTRACT_KINDS = [
  'software', 'writing', 'research', 'design', 'planning', 'admin', 'general',
]

/** Strip a markdown fence if a model wrapped its JSON in one. */
function stripFence(text) {
  const t = String(text || '').trim()
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  return (fenced ? fenced[1] : t).trim()
}

/** Pull the first JSON object out of a reply that may carry commentary. */
export function parseModelJson(text) {
  const body = stripFence(text)
  try {
    return JSON.parse(body)
  } catch {
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(body.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function strList(value, cap = 24) {
  if (!Array.isArray(value)) return []
  return [...new Set(
    value
      .map(v => String(v ?? '').trim().toLowerCase())
      .filter(v => v && v.length <= 64)
  )].slice(0, cap)
}

/**
 * The boundary. Whatever a provider returns, what leaves here is a valid
 * contract or nothing — never a half-filled object for the rest of the app to
 * trip over.
 */
export function normalizeContract(raw, { source = 'keywords', fallbackKind = 'general' } = {}) {
  if (!raw || typeof raw !== 'object') return null

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

// ── Providers ────────────────────────────────────────────────────────────────

/** Built-in profiles. No network, no key, always answers. */
async function keywordProvider(intentInput) {
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

/** A model running on this machine through Ollama. Nothing leaves the device. */
async function localProvider(intentInput, { signal, model = 'qwen2.5:3b', endpoint = 'http://127.0.0.1:11434' } = {}) {
  const res = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      prompt: buildPrompt(intentInput),
      stream: false,
      format: 'json',
      options: { temperature: 0.2 },
    }),
  })
  if (!res.ok) throw new Error(`ollama ${res.status}`)
  const data = await res.json()
  return normalizeContract(parseModelJson(data?.response), { source: 'local' })
}

/** The Anthropic API. Only the goal line is sent. */
async function cloudProvider(intentInput, { signal, apiKey, model = 'claude-sonnet-5' } = {}) {
  if (!apiKey) throw new Error('no api key')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      messages: [{ role: 'user', content: buildPrompt(intentInput) }],
    }),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}`)
  const data = await res.json()
  const text = data?.content?.map(c => c.text).join('') || ''
  return normalizeContract(parseModelJson(text), { source: 'cloud' })
}

const IMPLEMENTATIONS = {
  keywords: keywordProvider,
  local: localProvider,
  cloud: cloudProvider,
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
export async function deriveContract(intentInput, { provider = 'keywords', ...options } = {}) {
  const chosen = PROVIDERS.includes(provider) ? provider : 'keywords'
  const key = cacheKey(chosen, intentInput)
  if (cache.has(key)) return cache.get(key)

  const fallback = await keywordProvider(intentInput)

  if (chosen !== 'keywords') {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? PROVIDER_TIMEOUT_MS)
    try {
      const contract = await IMPLEMENTATIONS[chosen](intentInput, {
        ...options,
        signal: controller.signal,
      })
      if (contract) {
        cache.set(key, contract)
        return contract
      }
      // A model that answered with nothing usable is a failed model, not a
      // reason to start the session without a contract.
    } catch {
      // network down, Ollama absent, bad key, timeout, nonsense — all the same
      // from here: use what always works.
    } finally {
      clearTimeout(timer)
    }
  }

  if (fallback) cache.set(key, fallback)
  return fallback
}

// ── Plans ────────────────────────────────────────────────────────────────────
// A contract answers "what does this session need". A plan answers "how many
// sessions, in what order". Same switchable engines, same refusal to let a
// model's output through unchecked.
//
// Crucially, the model proposes the STEPS; it does not get to decide their
// LENGTH. How long a session actually holds is something the user's own history
// knows. A model inventing "90 minutes" for someone whose attention reliably
// goes at 45 produces a plan that fails on contact.

const MAX_STEPS = 8

export function buildPlanPrompt({ task = '', goal = '', context = '' } = {}) {
  const stated = [task, goal].filter(Boolean).join(' — ')
  return `Someone is planning work toward this goal:

"${stated}"${context ? `\n\nWhat they have said about it:\n${context}` : ''}

Break it into an ordered sequence of focused work sessions. Reply with JSON only:

{
  "steps": [
    { "label": "short imperative, e.g. Outline the introduction", "note": "one clause on what done means" }
  ],
  "kind": "software|writing|research|design|planning|admin|general",
  "confidence": "high|medium|low"
}

Rules:
- Between 2 and ${MAX_STEPS} steps. Fewer good steps beat many vague ones.
- Each step is ONE sitting of focused work.
- Do NOT give durations — session length is decided from the person's own
  measured history, not guessed.
- Order them so each step leaves something the next can build on.
- If the goal is too vague to break down, return one step restating it and
  "confidence": "low".`
}

/** The boundary again: whatever a model returns becomes clean labels or nothing. */
export function normalizePlan(raw, { source = 'keywords' } = {}) {
  if (!raw || typeof raw !== 'object') return null
  const list = Array.isArray(raw.steps) ? raw.steps : null
  if (!list) return null

  const steps = list
    .map(s => (typeof s === 'string' ? { label: s } : s))
    .filter(s => s && typeof s === 'object')
    .map(s => ({
      label: String(s.label ?? '').trim().slice(0, 120),
      note: String(s.note ?? '').trim().slice(0, 200),
    }))
    .filter(s => s.label)
    .slice(0, MAX_STEPS)

  if (steps.length === 0) return null
  return {
    source,
    steps,
    kind: CONTRACT_KINDS.includes(raw.kind) ? raw.kind : 'general',
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low',
  }
}

/** Generic shapes of work, used when no model is available. Honest about being
 *  a template: confidence is always 'low', so the UI can say so. */
const FALLBACK_PLANS = {
  writing:  ['Outline the structure', 'Write the first draft', 'Revise and tighten'],
  software: ['Sketch the approach', 'Build the first working version', 'Test and clean up'],
  research: ['Gather the sources', 'Read and take notes', 'Summarise the findings'],
  design:   ['Collect references', 'Draft the first version', 'Refine the details'],
  planning: ['List everything involved', 'Order it and cut', 'Write the final plan'],
  general:  ['Break the goal into parts', 'Do the main part', 'Finish and review'],
}

async function keywordPlan(input) {
  const intent = deriveSessionIntent(input)
  const steps = FALLBACK_PLANS[intent.primaryKind] || FALLBACK_PLANS.general
  return normalizePlan(
    { steps: steps.map(label => ({ label })), kind: intent.primaryKind, confidence: 'low' },
    { source: 'keywords' }
  )
}

async function modelPlan(provider, input, options) {
  const prompt = buildPlanPrompt(input)
  if (provider === 'local') {
    const { endpoint = 'http://127.0.0.1:11434', model = 'qwen2.5:3b', signal } = options
    const res = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ model, prompt, stream: false, format: 'json', options: { temperature: 0.3 } }),
    })
    if (!res.ok) throw new Error(`ollama ${res.status}`)
    return normalizePlan(parseModelJson((await res.json())?.response), { source: 'local' })
  }

  const { apiKey, model = 'claude-sonnet-5', signal } = options
  if (!apiKey) throw new Error('no api key')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: 900, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}`)
  const data = await res.json()
  return normalizePlan(parseModelJson(data?.content?.map(c => c.text).join('') || ''), { source: 'cloud' })
}

/**
 * Propose a plan. Same guarantees as deriveContract: never throws, never hangs,
 * always returns something — worst case the generic template, saying so.
 */
export async function derivePlan(input, { provider = 'keywords', ...options } = {}) {
  const chosen = PROVIDERS.includes(provider) ? provider : 'keywords'
  if (chosen !== 'keywords') {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000)
    try {
      const plan = await modelPlan(chosen, input, { ...options, signal: controller.signal })
      if (plan) return plan
    } catch {
      // absent, slow, rate-limited, nonsense — all the same: use the template.
    } finally {
      clearTimeout(timer)
    }
  }
  return keywordPlan(input)
}
