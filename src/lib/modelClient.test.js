import { describe, it, expect, vi, afterEach } from 'vitest'
import { callCloudModel } from './modelClient'

afterEach(() => vi.unstubAllGlobals())

describe('cloud transport boundary', () => {
  it('prefers the native command and never sends a browser request or key', async () => {
    const invoke = vi.fn().mockResolvedValue('{"ok":true}')
    vi.stubGlobal('window', { __TAURI__: { core: { invoke } } })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    const result = await callCloudModel('goal only', { apiKey: 'sk-secret', model: 'claude-test' })

    expect(result).toBe('{"ok":true}')
    expect(invoke).toHaveBeenCalledWith('call_cloud_model', { request: { prompt: 'goal only' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps cloud unavailable when the native bridge has no Keychain key', async () => {
    vi.stubGlobal('window', { __TAURI__: { core: { invoke: vi.fn().mockRejectedValue(new Error('missing')) } } })
    vi.stubGlobal('fetch', vi.fn())
    await expect(callCloudModel('goal only')).rejects.toThrow('missing')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('fails closed in dev even when a caller supplies a fake key', async () => {
    vi.stubGlobal('window', {})
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(callCloudModel('goal only', { apiKey: 'sk-fake' })).rejects.toThrow('native cloud bridge unavailable')
    expect(fetch).not.toHaveBeenCalled()
  })
})
