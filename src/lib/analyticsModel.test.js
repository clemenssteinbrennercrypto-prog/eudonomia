import { describe, expect, it } from 'vitest'
import {
  buildAnalyticsStory,
  buildAnalyticsExport,
  buildCohortProgress,
  buildExplorerSummary,
  buildFocusDistribution,
  buildInterventionSummary,
  knownComparableSessions,
} from './analyticsModel'

function session(index, extra = {}) {
  const actualSeconds = 30 * 60
  const average = extra.avgFocusScore ?? 70
  return {
    id: `s-${index}`,
    timestamp: 1_800_000_000_000 + index * 1000,
    actualSeconds,
    measuredSeconds: actualSeconds,
    focusedSeconds: Math.round(actualSeconds * 0.7),
    scoreSum: average * actualSeconds,
    avgFocusScore: average,
    scoreMeasured: true,
    deepFocusTimeVersion: 1,
    flowSeconds: 300,
    attentionScoringVersion: 2,
    goalOutcome: 'yes',
    plannedDuration: 30,
    ...extra,
  }
}

describe('Analytics model — version boundaries', () => {
  it('uses the newest explicit supported ruler and refuses missing versions', () => {
    const rows = [
      session(1, { attentionScoringVersion: 1 }),
      session(2, { attentionScoringVersion: undefined }),
      session(3, { attentionScoringVersion: 2 }),
    ]
    expect(knownComparableSessions(rows).map(item => item.id)).toEqual(['s-3'])
  })
})

describe('Analytics model — rolling cohort progress', () => {
  it('compares exactly the latest eight compatible sessions with the previous eight', () => {
    const rows = Array.from({ length: 16 }, (_, index) => session(index, {
      avgFocusScore: index >= 8 ? 80 : 60,
      flowSeconds: index >= 8 ? 600 : 300,
      goalOutcome: index >= 8 ? 'yes' : 'no',
    }))
    const result = buildCohortProgress(rows)
    expect(result.comparisonReady).toBe(true)
    expect(result.current.averageFocus).toBe(80)
    expect(result.previous.averageFocus).toBe(60)
    expect(result.focusDelta).toBe(20)
    expect(result.current.deepFocusSeconds).toBe(4800)
    expect(result.previous.deepFocusSeconds).toBe(2400)
    expect(result.deepFocusDeltaSeconds).toBe(2400)
    expect(result.outcomeDelta).toBe(100)
  })

  it('stays silent instead of comparing a partial previous cohort', () => {
    const result = buildCohortProgress(Array.from({ length: 12 }, (_, index) => session(index)))
    expect(result.comparisonReady).toBe(false)
    expect(result.focusDelta).toBeNull()
    expect(result.deepFocusDeltaSeconds).toBeNull()
    expect(result.outcomeDelta).toBeNull()
  })
})

describe('Analytics model — data', () => {
  it('summarizes only interventions that were actually stored', () => {
    const result = buildInterventionSummary([session(1, {
      distractionEvents: 2,
      phaseInterventions: { gentleReminders: 3, preDriftNudges: 1 },
    })])
    expect(result).toMatchObject({ alerts: 2, gentleReminders: 3, preDriftNudges: 1, protectionEvents: null })
  })

  it('counts only successful protection events once the new field is present', () => {
    const result = buildInterventionSummary([
      session(1, { protectionEvents: [{ kind: 'app_hidden' }, { kind: 'domain_redirected' }] }),
      session(2, { protectionEvents: [] }),
    ])
    expect(result.protectionEvents).toBe(2)
    expect(result.protectionTrackedSessions).toBe(2)
  })

  it('builds a complete focus distribution without inventing missing measurements', () => {
    const result = buildFocusDistribution([
      session(1, { avgFocusScore: 10 }),
      session(2, { avgFocusScore: 50 }),
      session(3, { avgFocusScore: 90 }),
      session(4, { scoreMeasured: false }),
    ])
    expect(result.count).toBe(3)
    expect(result.median).toBe(50)
    expect(result.bins.map(bin => bin.count)).toEqual([1, 0, 1, 0, 1])
  })

  it('keeps unrated sessions visible as an inbox', () => {
    const story = buildAnalyticsStory([session(1, { goalOutcome: null }), session(2)])
    expect(story.unratedSessions.map(item => item.id)).toEqual(['s-1'])
  })

  it('aggregates facets, quality, activity, and versioned score components', () => {
    const result = buildExplorerSummary([
      session(1, {
        workspace: { id: 'desk', name: 'Desk', revision: 1 },
        energyLevel: 'high',
        activityAlignment: { secondsByKind: { aligned: 900, off_goal: 120 } },
        focusPhases: { seconds: { deep: 600, steady: 300 } },
        timeline: [{ second: 5, scoreTrace: { version: 1, components: { face_present_base: 68, phone_confirmed: -45 } } }],
      }),
    ])
    expect(result.facets.workspace[0]).toMatchObject({ label: 'Desk', sessions: 1, averageFocus: 70, outcomeRate: null })
    expect(result.activity.aligned).toBe(900)
    expect(result.phases.deep).toBe(600)
    expect(result.scoreComponents).toMatchObject({ tracedSessions: 1, traceSamples: 1 })
    expect(result.scoreComponents.components.find(item => item.id === 'phone_confirmed').averageDeltaWhenActive).toBe(-45)
  })

  it('withholds intervention comparisons until both sides have three sessions', () => {
    const thin = buildExplorerSummary([
      session(1, { distractionEvents: 1 }),
      session(2, { distractionEvents: 0 }),
    ])
    expect(thin.interventionComparisons.alerts.focusDelta).toBeNull()

    const ready = buildExplorerSummary(Array.from({ length: 6 }, (_, index) => session(index, {
      distractionEvents: index < 3 ? 1 : 0,
      avgFocusScore: index < 3 ? 50 : 70,
    })))
    expect(ready.interventionComparisons.alerts.focusDelta).toBe(-20)
  })

  it('requires three measured sessions on both sides of an intervention comparison', () => {
    const rows = Array.from({ length: 6 }, (_, index) => session(index, {
      distractionEvents: index < 3 ? 1 : 0,
      ...(index === 0 ? {} : index < 3 ? { scoreMeasured: false } : {}),
    }))
    const result = buildExplorerSummary(rows)
    expect(result.interventionComparisons.alerts.with).toMatchObject({ sessionCount: 3, measuredCount: 1 })
    expect(result.interventionComparisons.alerts.focusDelta).toBeNull()
  })

  it('does not treat sessions without a protection ledger as zero interventions', () => {
    const result = buildExplorerSummary([
      session(1, { protectionEvents: [{ kind: 'app_hidden' }] }),
      session(2, { protectionEvents: [] }),
      session(3),
    ])
    expect(result.interventionComparisons.protection.with.sessionCount).toBe(1)
    expect(result.interventionComparisons.protection.without.sessionCount).toBe(1)
  })

  it('exports the selected derived evidence without claiming to be the raw archive', () => {
    const exported = buildAnalyticsExport([session(1, { plannedDuration: 60 })], {
      generatedAt: '2026-09-16T12:00:00.000Z',
      scope: { range: 'all' },
    })
    expect(exported).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-09-16T12:00:00.000Z',
      scope: { range: 'all' },
      generation: 2,
    })
    expect(exported.sessions[0]).toMatchObject({ id: 's-1', averageFocus: 70 })
    expect(exported.summary.facets.duration[0].label).toBe('60 min planned')
    expect(exported.sessions[0]).not.toHaveProperty('timeline')
  })
})
