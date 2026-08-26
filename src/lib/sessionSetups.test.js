import { describe, expect, it } from 'vitest'
import { buildRecentSessionSetups, normalizeSessionTags } from './sessionSetups'

describe('normalizeSessionTags', () => {
  it('cleans and deduplicates tags without changing their display case', () => {
    expect(normalizeSessionTags([' Coding ', 'coding', '', 'Deep work'])).toEqual(['Coding', 'Deep work'])
  })

  it('preserves an explicitly unlimited session setup', () => {
    expect(buildRecentSessionSetups([{
      task: 'Open-ended research',
      goal: 'Follow the evidence',
      plannedDuration: null,
    }])).toEqual([{
      task: 'Open-ended research',
      goal: 'Follow the evidence',
      duration: null,
      energyLevel: 'medium',
      tags: [],
    }])
  })

  it('refuses non-array values', () => {
    expect(normalizeSessionTags('Coding')).toEqual([])
  })
})

describe('buildRecentSessionSetups', () => {
  it('builds reusable setups from session history and removes exact duplicates', () => {
    const sessions = [
      { task: 'Draft essay', goal: 'Write 800 words', duration: 60, energyLevel: 'fresh', tags: ['Writing'] },
      { task: ' Draft essay ', goal: 'Write 800 words', duration: 60, energyLevel: 'tired', tags: ['Writing'] },
      { task: 'Read chapter', goal: 'Notes complete', plannedDuration: 30, tags: ['Study'] },
    ]

    expect(buildRecentSessionSetups(sessions)).toEqual([
      { task: 'Draft essay', goal: 'Write 800 words', duration: 60, energyLevel: 'fresh', tags: ['Writing'] },
      { task: 'Read chapter', goal: 'Notes complete', duration: 30, energyLevel: 'medium', tags: ['Study'] },
    ])
  })

  it('stays silent when history has no named sessions', () => {
    expect(buildRecentSessionSetups([{ goal: 'No task' }, null])).toEqual([])
  })
})
