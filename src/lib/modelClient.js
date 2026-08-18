// The one place that talks to a language model.
//
// Two features need a model now (goal contracts before a session, verdicts
// after one) and they must behave identically: same timeout, same headers,
// same failure semantics. Keeping the transport here means a changed model ID
// or a new provider is one edit, not a hunt.
//
// Every function here returns RAW TEXT. Parsing and validation belong to the
// caller, because each feature has its own shape and its own idea of what
// counts as unusable. A model that answers with prose is a failed call for
// both of them, but only the caller knows what to do about it.

/** A model gets this long before we stop waiting. Callers may shorten it. */
export const DEFAULT_TIMEOUT_MS = 12_000

export const PROVIDERS = ['keywords', 'local', 'cloud']

/** A model on this machine via Ollama. Nothing leaves the device. */
export async function callLocalModel(prompt, { signal, model = 'qwen2.5:3b', endpoint = 'http://127.0.0.1:11434' } = {}) {
  const res = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0.2 },
    }),
  })
  if (!res.ok) throw new Error(`ollama ${res.status}`)
  const data = await res.json()
  return data?.response ?? ''
}

/** The Anthropic API. Only what the caller put in the prompt is sent. */
export async function callCloudModel(prompt, { signal, apiKey, model = 'claude-sonnet-5', maxTokens = 700 } = {}) {
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
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}`)
  const data = await res.json()
  return data?.content?.map(c => c.text).join('') || ''
}

/**
 * Run one model call under a deadline. Returns null on ANY failure — network
 * down, provider absent, bad key, timeout, nonsense. A model that cannot
 * answer degrades the feature; it never breaks it, and it never hangs the UI.
 */
export async function callModel(prompt, { provider, timeoutMs = DEFAULT_TIMEOUT_MS, ...options } = {}) {
  if (provider !== 'local' && provider !== 'cloud') return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const call = provider === 'local' ? callLocalModel : callCloudModel
    return await call(prompt, { ...options, signal: controller.signal })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

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

/** Trim, lowercase and de-duplicate a list a model produced. */
export function strList(value, cap = 24) {
  if (!Array.isArray(value)) return []
  return [...new Set(
    value
      .map(v => String(v ?? '').trim().toLowerCase())
      .filter(v => v && v.length <= 64)
  )].slice(0, cap)
}
