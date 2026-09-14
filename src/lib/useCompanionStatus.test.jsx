/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCompanionStatus } from './useCompanionStatus'
import { fetchCompanionDebug } from './nativeCompanion'

vi.mock('./nativeCompanion', () => ({ fetchCompanionDebug: vi.fn() }))

const UNCHECKED = { checked: false, connected: false, helperInstalled: false, missingPermissions: [] }
const flush = () => act(async () => {})

beforeEach(() => {
  vi.useFakeTimers()
  fetchCompanionDebug.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useCompanionStatus', () => {
  it('never touches native IPC while disabled', async () => {
    const { result } = renderHook(() => useCompanionStatus({ enabled: false, intervalMs: 1000 }))
    await flush()
    await act(async () => { vi.advanceTimersByTime(5000) })

    expect(fetchCompanionDebug).not.toHaveBeenCalled()
    expect(result.current).toEqual(UNCHECKED)
  })

  it('does not carry a ready result across a disabled period', async () => {
    fetchCompanionDebug.mockResolvedValue({ helperInstalled: true })
    const { result, rerender } = renderHook(({ enabled }) => useCompanionStatus({ enabled, intervalMs: 1000 }), { initialProps: { enabled: true } })
    await flush()
    expect(result.current).toMatchObject({ checked: true, connected: true })

    rerender({ enabled: false })
    expect(result.current).toEqual(UNCHECKED)
    await flush()

    let resolveCheck
    fetchCompanionDebug.mockImplementation(() => new Promise(resolve => { resolveCheck = resolve }))
    rerender({ enabled: true })
    expect(result.current).toEqual(UNCHECKED)

    await act(async () => { resolveCheck(null) })
    expect(result.current).toMatchObject({ checked: true, connected: false })
  })

  it('drops a check that resolves after protection was switched off', async () => {
    let resolveCheck
    fetchCompanionDebug.mockImplementation(() => new Promise(resolve => { resolveCheck = resolve }))
    const { result, rerender } = renderHook(({ enabled }) => useCompanionStatus({ enabled, intervalMs: 1000 }), { initialProps: { enabled: true } })

    rerender({ enabled: false })
    await act(async () => { resolveCheck({ helperInstalled: true }) })
    expect(result.current).toEqual(UNCHECKED)
  })

  it('polls on the interval and stops after unmount', async () => {
    fetchCompanionDebug.mockResolvedValue({ helperInstalled: false, permissionMissing: 'System Events' })
    const { result, unmount } = renderHook(() => useCompanionStatus({ intervalMs: 1000 }))
    await flush()
    expect(fetchCompanionDebug).toHaveBeenCalledTimes(1)
    expect(result.current).toEqual({ checked: true, connected: true, helperInstalled: false, missingPermissions: [{ name: 'System Events', scope: 'system' }] })

    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(fetchCompanionDebug).toHaveBeenCalledTimes(3)

    unmount()
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(fetchCompanionDebug).toHaveBeenCalledTimes(3)
  })

  it('keeps a browser permission gap visible after the raw report disappears', async () => {
    vi.setSystemTime(1_000_000)
    fetchCompanionDebug.mockResolvedValueOnce({ helperInstalled: true, permissionMissing: 'Safari', lastActivity: { app: 'Safari', url: null, ts: 999_000 } })
    const { result } = renderHook(() => useCompanionStatus({ intervalMs: 1000 }))
    await flush()
    expect(result.current.missingPermissions).toEqual([{ name: 'Safari', scope: 'browser' }])

    fetchCompanionDebug.mockResolvedValueOnce({ helperInstalled: true, permissionMissing: null, lastActivity: { app: 'Slack', url: null, ts: 1_000_900 } })
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(result.current.missingPermissions).toEqual([{ name: 'Safari', scope: 'browser' }])

    fetchCompanionDebug.mockResolvedValueOnce({ helperInstalled: true, permissionMissing: null, lastActivity: { app: 'Safari', url: 'https://example.com', ts: 1_001_900 } })
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(result.current.missingPermissions).toEqual([])
  })

  it('forgets latched permissions across a disabled period', async () => {
    fetchCompanionDebug.mockResolvedValue({ helperInstalled: true, permissionMissing: 'Safari' })
    const { result, rerender } = renderHook(({ enabled }) => useCompanionStatus({ enabled, intervalMs: 1000 }), { initialProps: { enabled: true } })
    await flush()
    expect(result.current.missingPermissions).toHaveLength(1)

    rerender({ enabled: false })
    await flush()
    fetchCompanionDebug.mockResolvedValue({ helperInstalled: true, permissionMissing: null })
    rerender({ enabled: true })
    await flush()
    expect(result.current.missingPermissions).toEqual([])
  })
})
