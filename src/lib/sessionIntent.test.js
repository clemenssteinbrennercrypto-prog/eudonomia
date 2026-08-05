import { describe, expect, it } from 'vitest'
import {
  classifyGoalAwareActivity,
  deriveSessionIntent,
  getEnergyScoringProfile,
} from './sessionIntent'

describe('energy-aware session intent', () => {
  it('uses lower score expectations for tired sessions', () => {
    const fresh = getEnergyScoringProfile('fresh')
    const tired = getEnergyScoringProfile('tired')

    expect(tired.focusThreshold).toBeLessThan(fresh.focusThreshold)
    expect(tired.statusFocusedThreshold).toBeLessThan(fresh.statusFocusedThreshold)
    expect(tired.alertDelayMult).toBeGreaterThan(fresh.alertDelayMult)
    expect(tired.activityDistractionPenaltyMult).toBeLessThan(fresh.activityDistractionPenaltyMult)
  })

  it('stores energy context in the derived intent model', () => {
    const intent = deriveSessionIntent({
      task: 'Review React component',
      successCriteria: 'PR comments submitted',
      energyLevel: 'tired',
    })

    expect(intent.primaryKind).toBe('software')
    expect(intent.energyLevel).toBe('tired')
    expect(intent.intentStrictness).toBe('gentle')
  })

  it('is less punitive about unmatched activity when energy is tired', () => {
    const activity = { app: 'Safari', domain: 'example.com', title: 'Reference page' }
    const config = { focusApps: [], distractionApps: [], focusDomains: [], distractionDomains: [] }
    const baseIntent = {
      keywords: ['react', 'component'],
      toolHints: [],
      domainHints: [],
      confidence: 'medium',
    }

    expect(classifyGoalAwareActivity(activity, config, true, {
      ...baseIntent,
      intentStrictness: 'normal',
    }).kind).toBe('off_goal')

    expect(classifyGoalAwareActivity(activity, config, true, {
      ...baseIntent,
      intentStrictness: 'gentle',
    }).kind).toBe('unclear')
  })
})
