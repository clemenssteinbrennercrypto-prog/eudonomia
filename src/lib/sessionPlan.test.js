import { describe, expect, it } from 'vitest'
import { countWords, limitWords, SESSION_PLAN_WORD_LIMIT } from './sessionPlan'

describe('session plan word limit', () => {
  it('counts whitespace-separated words without counting blank input', () => {
    expect(countWords('  one\n two   three ')).toBe(3)
    expect(countWords('   ')).toBe(0)
  })

  it('keeps the plan at the explicit 1000-word boundary', () => {
    const input = Array.from({ length: SESSION_PLAN_WORD_LIMIT + 5 }, (_, index) => `word${index}`).join(' ')
    const limited = limitWords(input)
    expect(countWords(limited)).toBe(SESSION_PLAN_WORD_LIMIT)
    expect(limited.endsWith('word999')).toBe(true)
  })

  it('preserves paragraphs and spacing when trimming excess words', () => {
    expect(limitWords('first  item\n\nsecond item\nthird', 4)).toBe('first  item\n\nsecond item')
  })
})
