import { describe, expect, it, vi } from 'vitest'
import { runNativeReload } from './useUpdateAvailable'

describe('native Reload behavior', () => {
  it('installs an available native update instead of reloading the old UI', async () => {
    const reload = vi.fn()
    const invoke = vi.fn().mockResolvedValue({ installed: true, version: '0.1.3' })
    const result = await runNativeReload({ invoke, reload })
    expect(invoke).toHaveBeenCalledWith('install_native_update')
    expect(reload).not.toHaveBeenCalled()
    expect(result).toEqual({ installed: true, reloaded: false })
  })

  it('reloads normally when no native update exists', async () => {
    const reload = vi.fn()
    const result = await runNativeReload({
      invoke: vi.fn().mockResolvedValue({ installed: false, version: null, error: null }),
      reload,
    })
    expect(reload).toHaveBeenCalledOnce()
    expect(result).toEqual({ installed: false, reloaded: true })
  })

  it('surfaces an updater error without pretending the old build updated', async () => {
    const reload = vi.fn()
    const onState = vi.fn()
    const result = await runNativeReload({
      invoke: vi.fn().mockResolvedValue({ installed: false, error: 'signature rejected' }),
      reload,
      onState,
    })
    expect(reload).not.toHaveBeenCalled()
    expect(onState).toHaveBeenLastCalledWith({ installing: false, error: 'signature rejected' })
    expect(result.error).toBe('signature rejected')
  })
})
