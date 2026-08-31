import { beforeEach, describe, expect, it } from 'vitest'
import { createSessionPersister } from './sessionPersistence'
import { createLocalSessionRepository } from './sessionRepository.local'

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

let repo
let persister

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
  repo = createLocalSessionRepository()
  persister = createSessionPersister(repo)
})

const record = (overrides = {}) => ({
  task: 'Thesis',
  actualSeconds: 1800,
  measuredSeconds: 1800,
  focusedSeconds: 1400,
  avgFocusScore: 78,
  scoreMeasured: true,
  ...overrides,
})

/**
 * A repository whose save is held open until the test releases it. The local
 * adapter resolves on the next microtask, which is far too fast to reproduce
 * the window this module exists to handle — a native SQLite write or a slow
 * disk is where it actually bites.
 */
function withHeldSave() {
  let release
  const held = new Promise(resolve => { release = resolve })
  return {
    release,
    repository: {
      ...repo,
      async saveSession(data) {
        await held
        return repo.saveSession(data)
      },
    },
  }
}

// The regression this module exists for. The post-session screen is on-screen
// before the save resolves, so this is the ordinary case, not an edge case:
// answer the check-in immediately and it must still reach storage.
describe('a check-in answered before the save lands', () => {
  it('is held while the save is in flight, then written', async () => {
    const { release, repository } = withHeldSave()
    const p = createSessionPersister(repository)

    const saving = p.save(record())
    await p.edit({ goalOutcome: 'yes' })
    // Nothing to write against yet, so it is held rather than dropped.
    expect(p.savedId).toBeNull()
    expect(p.pendingEdits).toEqual({ goalOutcome: 'yes' })

    release()
    const saved = await saving
    expect((await repo.getSession(saved.id)).goalOutcome).toBe('yes')
    expect(p.pendingEdits).toEqual({})
  })

  it('is reflected in the record handed back, without a second read', async () => {
    const { release, repository } = withHeldSave()
    const p = createSessionPersister(repository)

    const saving = p.save(record())
    await p.edit({ goalOutcome: 'partly', blockerText: 'meetings' })
    release()
    const saved = await saving
    expect(saved.goalOutcome).toBe('partly')
    expect(saved.blockerText).toBe('meetings')
  })

  it('keeps the last answer when it is changed twice before the save lands', async () => {
    const { release, repository } = withHeldSave()
    const p = createSessionPersister(repository)

    const saving = p.save(record())
    await p.edit({ goalOutcome: 'yes' })
    await p.edit({ goalOutcome: 'no' })
    release()
    const saved = await saving
    expect((await repo.getSession(saved.id)).goalOutcome).toBe('no')
  })
})

describe('a check-in answered after the save landed', () => {
  it('is written straight through', async () => {
    const saved = await persister.save(record())
    await persister.edit({ goalOutcome: 'yes' })
    expect((await repo.getSession(saved.id)).goalOutcome).toBe('yes')
    expect(persister.pendingEdits).toEqual({})
  })

  it('merges successive answers rather than replacing the record', async () => {
    const saved = await persister.save(record({ task: 'Thesis' }))
    await persister.edit({ goalOutcome: 'yes' })
    await persister.edit({ completedText: 'intro done' })
    const stored = await repo.getSession(saved.id)
    expect(stored.goalOutcome).toBe('yes')
    expect(stored.completedText).toBe('intro done')
    expect(stored.task).toBe('Thesis')
  })
})

describe('failures do not lose the answer', () => {
  it('re-queues an edit whose write threw', async () => {
    const flaky = {
      ...repo,
      updateSession: async () => { throw new Error('disk gone') },
    }
    const p = createSessionPersister(flaky)
    await p.save(record())
    await p.edit({ goalOutcome: 'yes' })
    expect(p.pendingEdits).toEqual({ goalOutcome: 'yes' })
  })

  it('leaves queued edits intact when the save itself fails', async () => {
    const failing = {
      ...repo,
      saveSession: async () => { throw new Error('disk full') },
    }
    const p = createSessionPersister(failing)
    const saving = p.save(record())
    await p.edit({ goalOutcome: 'yes' })
    await expect(saving).rejects.toThrow('disk full')
    // Still queued, so a retry of the save carries the answer with it.
    expect(p.pendingEdits).toEqual({ goalOutcome: 'yes' })
  })

  it('carries the queued answer through a successful retry', async () => {
    let attempt = 0
    const flaky = {
      ...repo,
      saveSession: async (data) => {
        attempt += 1
        if (attempt === 1) throw new Error('disk full')
        return repo.saveSession(data)
      },
    }
    const p = createSessionPersister(flaky)
    await p.save(record()).catch(() => {})
    await p.edit({ goalOutcome: 'yes' })

    const saved = await p.save(record())
    expect((await repo.getSession(saved.id)).goalOutcome).toBe('yes')
  })
})

describe('starting a new session', () => {
  it('drops the previous session id and any queued answers', async () => {
    const first = await persister.save(record())
    await persister.edit({ goalOutcome: 'yes' })

    persister.reset()
    expect(persister.savedId).toBeNull()
    expect(persister.pendingEdits).toEqual({})

    // An answer to the new session must never land on the previous one.
    await persister.edit({ goalOutcome: 'no' })
    expect((await repo.getSession(first.id)).goalOutcome).toBe('yes')
  })
})
