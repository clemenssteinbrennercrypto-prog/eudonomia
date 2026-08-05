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
