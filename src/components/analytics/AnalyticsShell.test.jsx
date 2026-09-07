import { describe, expect, it } from 'vitest'
import { clearHistoryAndRefresh, historyDeletionMessage } from './AnalyticsShell'

// "Delete all history" can fail in two ways that mean opposite things. The
// shell used to print one sentence for both, so a delete that was refused by
// the database — and therefore removed nothing — was announced as a partial
// deletion. Someone reading that would reasonably believe some of their
// sessions were already gone.
describe('wording a failed history deletion', () => {
  it('calls it partial only when the native store really was cleared', () => {
    const partial = Object.assign(
      new Error('History was cleared from the native database, but the legacy copy could not be removed: storage unavailable'),
      { partialDeletion: true },
    )
    const message = historyDeletionMessage(partial)
    expect(message).toContain('only partially completed')
    expect(message).toContain('legacy copy could not be removed')
  })

  it('does not claim a partial deletion when nothing was deleted', () => {
    const message = historyDeletionMessage(new Error('database locked'))
    expect(message).not.toContain('partial')
    expect(message).toContain('could not be deleted')
    expect(message).toContain('database locked')
  })

  it('survives a thrown non-Error', () => {
    expect(historyDeletionMessage('database locked')).toContain('database locked')
  })
})

describe('clearing history and refreshing analytics', () => {
  it('does not reinterpret a refresh failure as a failed deletion', async () => {
    const cleared = []
    const result = await clearHistoryAndRefresh({
      clearAll: async () => {},
      refresh: async () => { throw new Error('read failed') },
      onHistoryCleared: error => cleared.push(error),
    })

    expect(result).toEqual({ deleted: true, deletionError: null, refreshError: 'read failed' })
    expect(cleared).toEqual([null])
  })

  it('does not report or signal deletion when the native transaction is refused', async () => {
    const cleared = []
    const result = await clearHistoryAndRefresh({
      clearAll: async () => { throw new Error('database locked') },
      refresh: async () => {},
      onHistoryCleared: error => cleared.push(error),
    })

    expect(result.deleted).toBe(false)
    expect(result.deletionError).toContain('could not be deleted')
    expect(result.refreshError).toBeNull()
    expect(cleared).toEqual([])
  })

  it('signals an authoritative empty store while naming a leftover legacy copy', async () => {
    const partial = Object.assign(new Error('legacy copy remains'), {
      partialDeletion: true,
      deletionCleanupError: 'storage unavailable',
    })
    const cleared = []
    const result = await clearHistoryAndRefresh({
      clearAll: async () => { throw partial },
      refresh: async () => {},
      onHistoryCleared: error => cleared.push(error),
    })

    expect(result.deleted).toBe(true)
    expect(result.deletionError).toContain('only partially completed')
    expect(cleared).toEqual(['storage unavailable'])
  })
})
