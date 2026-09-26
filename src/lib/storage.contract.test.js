/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CONTRACT_KEY,
  disableOptionalModelProviders,
  loadContractSettings,
  saveContractSettings,
} from './storage'

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

describe('dormant model-provider settings', () => {
  beforeEach(() => { globalThis.localStorage = new MemoryStorage() })

  it('migrates an old cloud selection to built-in and removes a legacy browser key', () => {
    localStorage.setItem(CONTRACT_KEY, JSON.stringify({
      provider: 'cloud',
      apiKey: 'sk-private',
      localModel: 'custom-model',
    }))

    expect(loadContractSettings()).toMatchObject({ provider: 'keywords', localModel: 'custom-model' })
    expect(JSON.parse(localStorage.getItem(CONTRACT_KEY))).toEqual(expect.objectContaining({ provider: 'keywords' }))
    expect(localStorage.getItem(CONTRACT_KEY)).not.toContain('sk-private')
  })

  it('does not allow dormant callers to reactivate a hidden provider', () => {
    expect(saveContractSettings({ provider: 'local' }).provider).toBe('keywords')
    expect(loadContractSettings().provider).toBe('keywords')
  })

  it('resets the provider when cleaning up legacy credentials at app start', () => {
    localStorage.setItem(CONTRACT_KEY, JSON.stringify({ provider: 'cloud', apiKey: 'sk-private' }))

    disableOptionalModelProviders()

    expect(JSON.parse(localStorage.getItem(CONTRACT_KEY))).toEqual({ provider: 'keywords' })
  })
})
