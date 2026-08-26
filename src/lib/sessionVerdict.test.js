import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  MAX_PROMPT_CHARS,
  buildVerdictInput,
  buildVerdictPrompt,
  deriveVerdict,
  normalizeVerdict,
} from './sessionVerdict'

afterEach(() => vi.unstubAllGlobals())

// A session record as SessionScreen actually writes one, carrying every field
// that must NOT reach a model: a per-second timeline, window titles in `label`,
// title-derived artifact names, the watched folder path, changed file names.
function sessionFixture(overrides = {}) {
  return {
    actualSeconds: 3600,
    plannedDuration: 60,
    focusedSeconds: 2520,
    trackingFaulted: false,
    scoreMeasured: true,
    sessionIntent: { task: 'Thesis', goal: 'Draft the intro chapter' },
    timeline: Array.from({ length: 3600 }, (_, i) => ({ second: i, score: 70 })),
    activityAlignment: {
      secondsByKind: { aligned: 1800, supportive: 600, off_goal: 900, distraction: 300, unclear: 0, blocked: 0 },
      byActivity: {
        'microsoft word': {
          label: 'thesis_intro_v3.docx — Microsoft Word',
          app: 'Microsoft Word', domain: '', kind: 'aligned', basis: 'contract_tool', seconds: 1800,
        },
        'youtube.com': {
          label: 'How to stop procrastinating - YouTube',
          app: 'Safari', domain: 'youtube.com', kind: 'distraction', basis: 'common_distraction', seconds: 300,
        },
      },
      byArtifact: {
        thesis_intro_v3: { artifact: 'thesis_intro_v3', app: 'Microsoft Word', kind: 'aligned', seconds: 1800 },
      },
      events: [{ second: 42, kind: 'distraction', label: 'How to stop procrastinating - YouTube' }],
    },
    outputEvidence: {
      watched: true,
      root: '/Users/clemens/Documents/Uni/Thesis',
      changedNames: ['thesis_intro_v3.docx', 'notes_private.md'],
      filesChanged: 2, filesCreated: 1, bytesAdded: 8192,
      commits: 0, linesAdded: 0, linesRemoved: 0,
    },
    sessionContract: {
      expectedTools: ['word', 'pages'],
      supporting: ['scholar.google.com'],
      output: { type: 'document', unit: 'words', plausibleRange: [600, 1200] },
    },
    ...overrides,
  }
}

// This is the expensive boundary. It exists for cost AND privacy at once: the
// per-second timeline is 92% of a session record's tokens and also useless to a
// model, and the fields dropped alongside it are the ones carrying private
// content. A regression here is invisible — it just gets slower, pricier and
// leakier — so it is nailed down explicitly.
describe('the aggregation keeps private content on the device', () => {
  const prompt = buildVerdictPrompt(buildVerdictInput(sessionFixture()))

  it('never sends the per-second timeline', () => {
    expect(prompt).not.toContain('"second"')
    expect(prompt.length).toBeLessThan(MAX_PROMPT_CHARS)
  })

  it('never sends window titles', () => {
    expect(prompt).not.toContain('thesis_intro_v3.docx — Microsoft Word')
    expect(prompt).not.toContain('How to stop procrastinating')
  })

  it('never sends file names or the watched folder path', () => {
    expect(prompt).not.toContain('thesis_intro_v3')
    expect(prompt).not.toContain('notes_private.md')
    expect(prompt).not.toContain('/Users/')
    expect(prompt).not.toContain('Documents')
  })

  it('sends only the bare hostname, never a URL path', () => {
    const input = buildVerdictInput(sessionFixture({
      activityAlignment: {
        secondsByKind: { aligned: 0, supportive: 0, off_goal: 0, distraction: 900, unclear: 0, blocked: 0 },
        byActivity: {
          v: { label: 'x', app: 'Safari', domain: 'https://www.youtube.com/watch?v=abc123', kind: 'distraction', seconds: 900 },
        },
      },
    }))
    expect(input.activities[0].site).toBe('www.youtube.com')
    expect(buildVerdictPrompt(input)).not.toContain('abc123')
  })

  it('does send what is needed to judge: goal, apps, durations, counts', () => {
    expect(prompt).toContain('Draft the intro chapter')
    expect(prompt).toContain('Microsoft Word')
    expect(prompt).toContain('youtube.com')
    expect(prompt).toContain('2 changed')
  })
})

describe('it refuses rather than guessing', () => {
  it('says nothing without a stated goal — there is no yardstick', () => {
    expect(buildVerdictInput(sessionFixture({ sessionIntent: {} }))).toBeNull()
  })

  it('says nothing about a session too short to be evidence', () => {
    expect(buildVerdictInput(sessionFixture({ actualSeconds: 90 }))).toBeNull()
  })

  it('says nothing when neither activity nor output was observed', () => {
    expect(buildVerdictInput(sessionFixture({
      activityAlignment: { secondsByKind: {}, byActivity: {} },
      outputEvidence: null,
    }))).toBeNull()
  })

  it('still judges when the companion was off but a folder moved', () => {
    const input = buildVerdictInput(sessionFixture({
      activityAlignment: { secondsByKind: {}, byActivity: {} },
    }))
    expect(input).not.toBeNull()
    expect(input.output.filesChanged).toBe(2)
  })

  it('omits focus entirely when the camera faulted — absent, not zero', () => {
    const input = buildVerdictInput(sessionFixture({ trackingFaulted: true }))
    expect(input.focusPct).toBeNull()
    expect(buildVerdictPrompt(input)).not.toContain('Attention:')
  })

  it('does not describe an unmeasured camera gap as distracted time', () => {
    const input = buildVerdictInput(sessionFixture({
      actualSeconds: 3600,
      measuredSeconds: 1800,
      focusedSeconds: 900,
    }))
    expect(input.focusPct).toBe(50)
  })

  it('keeps valid partial measurement when a later camera fault ended the session', () => {
    const input = buildVerdictInput(sessionFixture({
      trackingFaulted: true,
      avgFocusScore: 75,
      measuredSeconds: 1800,
      focusedSeconds: 1350,
    }))
    expect(input.focusPct).toBe(75)
  })

  it('refuses a present zero measurement instead of dividing by wall time', () => {
    const input = buildVerdictInput(sessionFixture({
      measuredSeconds: 0,
      focusedSeconds: 0,
    }))
    expect(input.focusPct).toBeNull()
  })

  it('survives records written before these fields existed', () => {
    for (const junk of [null, undefined, 'text', 42, []]) {
      expect(buildVerdictInput(junk)).toBeNull()
    }
    expect(buildVerdictInput(sessionFixture({
      activityAlignment: undefined, outputEvidence: undefined, sessionContract: undefined,
    }))).toBeNull()
  })
})

describe('normalizeVerdict is a hard boundary', () => {
  const valid = { matched: 'partly', headline: 'You wrote, but not the chapter.', reason: 'r', suggestion: 's', confidence: 'high' }

  it('passes a well-formed verdict through', () => {
    expect(normalizeVerdict(valid, { source: 'cloud' })).toMatchObject({ source: 'cloud', matched: 'partly', confidence: 'high' })
  })

  it('rejects an invented verdict value rather than rendering it', () => {
    expect(normalizeVerdict({ ...valid, matched: 'kind of' })).toBeNull()
  })

  it('rejects a verdict with no sentence to show', () => {
    expect(normalizeVerdict({ ...valid, headline: '   ' })).toBeNull()
  })

  it('falls back to low confidence rather than trusting an invented level', () => {
    expect(normalizeVerdict({ ...valid, confidence: 'certain' }).confidence).toBe('low')
  })

  it('caps runaway strings', () => {
    const v = normalizeVerdict({ ...valid, headline: 'x'.repeat(5000), reason: 'y'.repeat(5000) })
    expect(v.headline.length).toBeLessThanOrEqual(140)
    expect(v.reason.length).toBeLessThanOrEqual(400)
  })

  it('refuses non-objects outright', () => {
    for (const bad of [null, undefined, 'text', 42, []]) {
      expect(normalizeVerdict(bad)).toBeNull()
    }
  })
})

describe('deriveVerdict degrades to silence, never to fiction', () => {
  const modelReplies = body => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })))

  it('returns nothing on the keyword provider — it cannot judge intent', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await deriveVerdict(sessionFixture(), { provider: 'keywords' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses a working local model', async () => {
    modelReplies({ response: JSON.stringify({ matched: 'no', headline: 'You drifted.', confidence: 'high' }) })
    const v = await deriveVerdict(sessionFixture(), { provider: 'local' })
    expect(v).toMatchObject({ source: 'local', matched: 'no' })
  })

  it('returns nothing when the model is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    expect(await deriveVerdict(sessionFixture(), { provider: 'local' })).toBeNull()
  })

  it('returns nothing when the model replies with encouragement', async () => {
    modelReplies({ response: 'Great job today, keep it up!' })
    expect(await deriveVerdict(sessionFixture(), { provider: 'local' })).toBeNull()
  })

  it('returns nothing when the cloud provider has no key', async () => {
    expect(await deriveVerdict(sessionFixture(), { provider: 'cloud' })).toBeNull()
  })

  it('does not hang the end screen behind a slow model', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, opts) => new Promise((_resolve, reject) => {
      opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })))
    expect(await deriveVerdict(sessionFixture(), { provider: 'local', timeoutMs: 30 })).toBeNull()
  })

  it('never calls a model for a session it could not judge anyway', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await deriveVerdict(sessionFixture({ actualSeconds: 30 }), { provider: 'local' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
