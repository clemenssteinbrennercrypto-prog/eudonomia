import { describe, it, expect } from 'vitest'
import {
  artifactFromTitle,
  classifyGoalAwareActivity,
  deriveSessionIntent,
  emptyActivityAlignmentSummary,
  recordActivityAlignment,
  summarizeSessionAlignment,
} from './sessionIntent'

// ── Energy-aware intent ──────────────────────────────────────────────────────
describe('energy is context, never calibration', () => {
  it('records the declared energy without exporting a scoring profile', async () => {
    const intent = deriveSessionIntent({ task: 'Review React component', energyLevel: 'tired' })
    expect(intent.primaryKind).toBe('software')
    expect(intent.energyLevel).toBe('tired')

    // The scoring profile is gone on purpose: shifting thresholds by
    // self-reported mood made the same behaviour score differently day to day,
    // which destroys comparability across sessions.
    const mod = await import('./sessionIntent')
    expect(mod.getEnergyScoringProfile).toBeUndefined()
    expect(intent.intentStrictness).toBeUndefined()
  })

  it('classifies activity identically regardless of declared energy', () => {
    const activity = { app: 'Safari', domain: 'example.com', title: 'Reference page' }
    const config = { focusApps: [], distractionApps: [], focusDomains: [], distractionDomains: [] }
    const base = { keywords: ['react', 'component'], toolHints: [], domainHints: [], confidence: 'medium' }

    const tired = classifyGoalAwareActivity(activity, config, true, { ...base, energyLevel: 'tired' })
    const fresh = classifyGoalAwareActivity(activity, config, true, { ...base, energyLevel: 'fresh' })
    expect(tired.kind).toBe(fresh.kind)
  })
})

// ── Artifacts ────────────────────────────────────────────────────────────────
// The artifact is what turns "40 minutes in Word" into "40 minutes on
// thesis_intro_v3". Window titles are the only place that information exists,
// and their shape varies per app, so the parsing is worth pinning down.
describe('artifactFromTitle', () => {
  it('takes the document and drops the trailing app name', () => {
    expect(artifactFromTitle('thesis_intro_v3.docx — Word', 'Word')).toBe('thesis_intro_v3.docx')
    expect(artifactFromTitle('SessionScreen.jsx — eudaimonia', 'Code')).toBe('SessionScreen.jsx')
    expect(artifactFromTitle('Budget 2026 - Numbers', 'Numbers')).toBe('Budget 2026')
  })

  it('handles every separator macOS apps actually use', () => {
    for (const sep of ['—', '–', '|', '-']) {
      expect(artifactFromTitle(`Chapter One ${sep} Pages`, 'Pages')).toBe('Chapter One')
    }
  })

  it('strips a trailing unread count from browser tabs', () => {
    expect(artifactFromTitle('Inbox (12) - Gmail', 'Chrome')).toBe('Inbox')
  })

  it('keeps the title when the app name is not in it', () => {
    expect(artifactFromTitle('Untitled document', 'Docs')).toBe('Untitled document')
  })

  it('returns empty for nothing rather than inventing a name', () => {
    expect(artifactFromTitle('')).toBe('')
    expect(artifactFromTitle(null)).toBe('')
    expect(artifactFromTitle(undefined, 'Word')).toBe('')
  })

  it('never returns only the app name when a document is present', () => {
    // Regression guard: a naive "last segment" parse returns "Word" here.
    expect(artifactFromTitle('report.docx — Word', 'Word')).not.toBe('Word')
  })
})

describe('classifyGoalAwareActivity carries the artifact', () => {
  const connected = true
  const config = { focusApps: [], distractionApps: [], focusDomains: [], distractionDomains: [] }

  it('uses the document for a native app', () => {
    const c = classifyGoalAwareActivity(
      { app: 'Word', title: 'thesis_intro_v3.docx — Word' }, config, connected, null
    )
    expect(c.artifact).toBe('thesis_intro_v3.docx')
    expect(c.app).toBe('Word')
  })

  it('uses the domain for a browser, where the site IS the artifact', () => {
    const c = classifyGoalAwareActivity(
      { app: 'Chrome', domain: 'github.com', title: 'PR #12 — GitHub' }, config, connected, null
    )
    expect(c.artifact).toBe('github.com')
  })

  it('falls back to the app when there is no title at all', () => {
    const c = classifyGoalAwareActivity({ app: 'Terminal' }, config, connected, null)
    expect(c.artifact).toBe('Terminal')
  })
})

describe('time is accumulated per artifact', () => {
  it('separates two documents inside the same app', () => {
    let sum = emptyActivityAlignmentSummary()
    const cls = (title) => classifyGoalAwareActivity(
      { app: 'Word', title }, { focusApps: [], distractionApps: [] }, true, null
    )
    for (let i = 0; i < 40; i++) sum = recordActivityAlignment(sum, cls('thesis.docx — Word'), i)
    for (let i = 0; i < 6; i++)  sum = recordActivityAlignment(sum, cls('budget.xlsx — Word'), 40 + i)

    const { topArtifacts } = summarizeSessionAlignment(sum, 46)
    expect(topArtifacts[0]).toMatchObject({ artifact: 'thesis.docx', seconds: 40 })
    expect(topArtifacts[1]).toMatchObject({ artifact: 'budget.xlsx', seconds: 6 })
  })

  it('survives a summary written before artifacts existed', () => {
    // Sessions already on disk have no byArtifact key; the report must not throw.
    const legacy = { secondsByKind: { aligned: 5 }, byActivity: {}, events: [] }
    expect(() => summarizeSessionAlignment(legacy, 5)).not.toThrow()
    expect(summarizeSessionAlignment(legacy, 5).topArtifacts).toEqual([])
  })
})

// ── Contract-driven classification ──────────────────────────────────────────
// The contract knows what THIS goal needs. The keyword profiles only know what
// "writing" generally looks like, and nothing at all about a goal outside their
// six categories.
describe('classification against a session contract', () => {
  const config = { focusApps: [], distractionApps: [], focusDomains: [], distractionDomains: [] }
  const contract = {
    source: 'local',
    kind: 'writing',
    expectedTools: ['word', 'overleaf.com'],
    supporting: ['scholar.google.com'],
    offGoal: ['youtube.com'],
    output: { type: 'document', unit: 'words', plausibleRange: [600, 1200], artifactHint: 'thesis' },
    confidence: 'high',
  }
  const classify = (activity, c = contract) =>
    classifyGoalAwareActivity(activity, config, true, null, c).kind

  it('calls an expected tool aligned', () => {
    expect(classify({ app: 'Word' })).toBe('aligned')
    expect(classify({ app: 'Safari', domain: 'overleaf.com' })).toBe('aligned')
  })

  it('calls a supporting source supportive, not aligned', () => {
    expect(classify({ app: 'Safari', domain: 'scholar.google.com' })).toBe('supportive')
  })

  it('calls a goal-specific off-goal site a distraction', () => {
    expect(classify({ app: 'Safari', domain: 'youtube.com' })).toBe('distraction')
  })

  it('treats the expected artifact in a window title as the strongest signal', () => {
    // Not a listed tool, but plainly the right document.
    expect(classify({ app: 'Preview', title: 'thesis_chapter_1.pdf — Preview' })).toBe('aligned')
  })

  it('a confident contract can call unmatched activity off-goal', () => {
    // Numbers is neither a listed tool nor a common distraction — only a
    // contract that knows this goal can judge it. The keyword profiles cannot
    // do this at all for a goal outside their six categories.
    expect(classify({ app: 'Numbers' })).toBe('off_goal')
  })

  it('stays quiet when the contract is not confident', () => {
    const unsure = { ...contract, confidence: 'low' }
    expect(classify({ app: 'Numbers' }, unsure)).toBe('unclear')
  })

  it('a common distraction is still caught before the contract is consulted', () => {
    expect(classify({ app: 'TikTok' })).toBe('distraction')
  })

  it("the user's own blocklist still outranks the contract", () => {
    // Word is an expected tool here, but the user explicitly blocked it.
    const blocked = { focusApps: [], distractionApps: ['Word'], focusDomains: [], distractionDomains: [] }
    expect(classifyGoalAwareActivity({ app: 'Word' }, blocked, true, null, contract).kind).toBe('blocked')
  })

  it('behaves exactly as before when no contract is supplied', () => {
    const intent = deriveSessionIntent({ task: 'Write the intro chapter', goal: 'draft essay' })
    const withNone = classifyGoalAwareActivity({ app: 'Word' }, config, true, intent)
    const withNull = classifyGoalAwareActivity({ app: 'Word' }, config, true, intent, null)
    expect(withNone.kind).toBe(withNull.kind)
    expect(withNone.basis).not.toContain('contract')
  })
})
