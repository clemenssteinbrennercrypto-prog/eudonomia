import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  PROVIDERS,
  buildPrompt,
  clearContractCache,
  deriveContract,
  normalizeContract,
  parseModelJson,
} from './intentContract'

const goalInput = { task: 'Thesis', goal: 'Write the intro chapter', tags: ['Writing'] }

beforeEach(() => clearContractCache())
afterEach(() => vi.unstubAllGlobals())

// A language model will eventually return prose, a fence, a missing field or an
// invented enum. None of that may reach the rest of the app.
describe('parseModelJson survives how models actually reply', () => {
  it('reads plain JSON', () => {
    expect(parseModelJson('{"kind":"writing"}')).toEqual({ kind: 'writing' })
  })

  it('reads JSON wrapped in a markdown fence', () => {
    expect(parseModelJson('```json\n{"kind":"writing"}\n```')).toEqual({ kind: 'writing' })
  })

  it('digs the object out of surrounding commentary', () => {
    expect(parseModelJson('Sure! Here you go:\n{"kind":"writing"}\nHope that helps.'))
      .toEqual({ kind: 'writing' })
  })

  it('returns null for a reply with no JSON at all', () => {
    expect(parseModelJson('I cannot help with that.')).toBeNull()
    expect(parseModelJson('')).toBeNull()
    expect(parseModelJson(null)).toBeNull()
  })
})

describe('normalizeContract is a hard boundary', () => {
  const valid = {
    restatedGoal: 'Write the intro chapter',
    kind: 'writing',
    expectedTools: ['Word', 'Pages'],
    supporting: ['scholar.google.com'],
    offGoal: ['youtube.com'],
    output: { type: 'document', unit: 'words', plausibleRange: [600, 1200], artifactHint: 'thesis' },
    confidence: 'high',
  }

  it('passes a well-formed contract through, lowercasing tool names', () => {
    const c = normalizeContract(valid, { source: 'local' })
    expect(c.source).toBe('local')
    expect(c.expectedTools).toEqual(['word', 'pages'])
    expect(c.output.plausibleRange).toEqual([600, 1200])
  })

  it('rejects an invented kind and output type rather than passing them on', () => {
    const c = normalizeContract({ ...valid, kind: 'vibes', output: { ...valid.output, type: 'telepathy' } })
    expect(c.kind).toBe('general')
    expect(c.output.type).toBe('other')
  })

  it('drops a nonsensical range instead of trusting it', () => {
    for (const bad of [[1200, 600], [-5, 10], ['a', 'b'], [5], null]) {
      const c = normalizeContract({ ...valid, output: { ...valid.output, plausibleRange: bad } })
      expect(c.output.plausibleRange).toBeNull()
    }
  })

  it('accepts snake_case, since models ignore the casing they were asked for', () => {
    const c = normalizeContract({
      restated_goal: 'x', kind: 'writing',
      expected_tools: ['Word'], supporting: [], off_goal: ['tiktok.com'],
      output: { type: 'document', plausible_range: [10, 20], artifact_hint: 'ch1' },
    })
    expect(c.expectedTools).toEqual(['word'])
    expect(c.offGoal).toEqual(['tiktok.com'])
    expect(c.output.plausibleRange).toEqual([10, 20])
  })

  it('refuses a contract that expects nothing — it could never judge anything', () => {
    expect(normalizeContract({ ...valid, expectedTools: [], supporting: [] })).toBeNull()
  })

  it('refuses non-objects outright', () => {
    for (const bad of [null, undefined, 'text', 42, []]) {
      expect(normalizeContract(bad)).toBeNull()
    }
  })

  it('caps runaway lists and absurd strings', () => {
    const c = normalizeContract({
      ...valid,
      expectedTools: Array.from({ length: 200 }, (_, i) => `tool${i}`),
      restatedGoal: 'x'.repeat(5000),
    })
    expect(c.expectedTools.length).toBeLessThanOrEqual(24)
    expect(c.restatedGoal.length).toBeLessThanOrEqual(200)
  })
})

describe('the prompt sends the intention and nothing else', () => {
  it('carries the goal', () => {
    expect(buildPrompt(goalInput)).toContain('Write the intro chapter')
  })

  it('never carries activity, window titles or file names', () => {
    const p = buildPrompt(goalInput)
    for (const leak of ['thesis_intro_v3.docx', 'localhost', 'youtube.com/watch', '/Users/']) {
      expect(p).not.toContain(leak)
    }
  })
})

describe('switching providers is safe', () => {
  it('every provider is async and returns the same shape', async () => {
    const c = await deriveContract(goalInput, { provider: 'keywords' })
    expect(c).toMatchObject({
      source: 'keywords',
      kind: expect.any(String),
      expectedTools: expect.any(Array),
      output: expect.any(Object),
    })
  })

  it('an unknown provider name falls back rather than throwing', async () => {
    const c = await deriveContract(goalInput, { provider: 'telepathy' })
    expect(c.source).toBe('keywords')
    expect(PROVIDERS).not.toContain('telepathy')
  })

  it('uses a working local model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          kind: 'writing', expectedTools: ['obsidian'], supporting: [],
          output: { type: 'document', unit: 'words', plausibleRange: [500, 900] },
          confidence: 'high',
        }),
      }),
    })))
    const c = await deriveContract(goalInput, { provider: 'local' })
    expect(c.source).toBe('local')
    expect(c.expectedTools).toEqual(['obsidian'])
  })

  it('falls back to keywords when the model is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const c = await deriveContract(goalInput, { provider: 'local' })
    expect(c.source).toBe('keywords')
  })

  it('falls back when the model replies with nonsense', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ response: 'I think you should just try your best!' }),
    })))
    const c = await deriveContract(goalInput, { provider: 'local' })
    expect(c.source).toBe('keywords')
  })

  it('falls back when the cloud provider has no key', async () => {
    const c = await deriveContract(goalInput, { provider: 'cloud' })
    expect(c.source).toBe('keywords')
  })

  it('does not hang the session behind a slow model', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, opts) => new Promise((_resolve, reject) => {
      opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })))
    const c = await deriveContract(goalInput, { provider: 'local', timeoutMs: 30 })
    expect(c.source).toBe('keywords')
  })

  it('asks a model once per distinct goal, not once per session', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        response: JSON.stringify({ kind: 'writing', expectedTools: ['word'], supporting: [] }),
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await deriveContract(goalInput, { provider: 'local' })
    await deriveContract(goalInput, { provider: 'local' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
