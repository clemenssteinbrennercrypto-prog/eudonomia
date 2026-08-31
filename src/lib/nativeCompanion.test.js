import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCompanionDebug,
  fetchNativeCameraStatus,
  fetchOutputDelta,
  listenActivityUpdates,
  listenNativeCameraLandmarks,
  normalizeCompanionSession,
  pushCompanionSession,
  setNativeCameraPreview,
  startNativeCameraPrototype,
  stopNativeCameraPrototype,
} from './nativeCompanion'

afterEach(() => {
  vi.restoreAllMocks()
  delete globalThis.window
})

describe('fetchCompanionDebug', () => {
  it('uses only the native Tauri command', async () => {
    const invoke = vi.fn().mockResolvedValue({ sessionState: 'inactive' })
    const fetch = vi.fn()
    globalThis.window = { __TAURI__: { core: { invoke } }, fetch }

    await expect(fetchCompanionDebug()).resolves.toEqual({ sessionState: 'inactive' })
    expect(invoke).toHaveBeenCalledWith('get_companion_debug')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses to expose debug state outside the native runtime', async () => {
    const fetch = vi.fn()
    globalThis.window = { fetch }

    await expect(fetchCompanionDebug()).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('degrades to no debug state when native IPC fails', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('IPC unavailable'))
    globalThis.window = { __TAURI__: { core: { invoke } } }

    await expect(fetchCompanionDebug()).resolves.toBeNull()
  })
})

describe('native session bridge', () => {
  it('sends blocking state only through the native command', async () => {
    const invoke = vi.fn().mockResolvedValue({
      sessionActive: true,
      sessionState: 'active',
      sessionEndTs: 500,
      sessionUpdatedTs: 100,
    })
    globalThis.window = { __TAURI__: { core: { invoke } } }

    await expect(pushCompanionSession({
      active: true,
      endTs: 500,
      blockedApps: ['Discord'],
      blockedDomains: ['reddit.com'],
    })).resolves.toMatchObject({ active: true, sessionState: 'active' })
    expect(invoke).toHaveBeenCalledWith('set_companion_session', {
      payload: {
        active: true,
        endTs: 500,
        blockedApps: ['Discord'],
        blockedDomains: ['reddit.com'],
        strictMode: false,
        allowedApps: [],
        sessionState: null,
      },
    })
  })

  it('refuses a native response that did not activate the requested session', async () => {
    const invoke = vi.fn().mockResolvedValue({ sessionActive: false, sessionState: 'inactive' })
    globalThis.window = { __TAURI__: { core: { invoke } } }

    await expect(pushCompanionSession({ active: true, endTs: 500 })).resolves.toBe(false)
  })

  it('normalizes malformed state names instead of trusting them', () => {
    expect(normalizeCompanionSession({ active: true, sessionState: 'invented' }))
      .toMatchObject({ active: true, sessionState: 'active' })
  })
})

describe('native events and output', () => {
  it('passes only the Tauri event payload to activity consumers', async () => {
    const unlisten = vi.fn()
    const listen = vi.fn(async (_name, handler) => {
      handler({ payload: { app: 'Orca', ts: 123 } })
      return unlisten
    })
    globalThis.window = { __TAURI__: { event: { listen } } }
    const onUpdate = vi.fn()

    await expect(listenActivityUpdates(onUpdate)).resolves.toBe(unlisten)
    expect(listen).toHaveBeenCalledWith('activity-updated', expect.any(Function))
    expect(onUpdate).toHaveBeenCalledWith({ app: 'Orca', ts: 123 })
  })

  it('stays silent when no output folder is watched', async () => {
    const invoke = vi.fn().mockResolvedValue({ watched: false })
    globalThis.window = { __TAURI__: { core: { invoke } } }

    await expect(fetchOutputDelta()).resolves.toBeNull()
  })

  it('keeps native camera prototype traffic on Tauri commands and events', async () => {
    const unlisten = vi.fn()
    const invoke = vi.fn().mockResolvedValue({ state: 'running', frameSequence: 7 })
    const listen = vi.fn(async (_name, handler) => {
      handler({ payload: { frameSequence: 7, facePresent: true, landmarks: [] } })
      return unlisten
    })
    globalThis.window = { __TAURI__: { core: { invoke }, event: { listen } } }
    const onLandmarks = vi.fn()

    await expect(startNativeCameraPrototype()).resolves.toMatchObject({ state: 'running' })
    await expect(fetchNativeCameraStatus()).resolves.toMatchObject({ frameSequence: 7 })
    await expect(setNativeCameraPreview({
      x: 10, y: 20, width: 160, height: 120, viewportHeight: 800,
      visible: true, cornerRadius: 8,
    })).resolves.toMatchObject({ state: 'running' })
    await expect(stopNativeCameraPrototype()).resolves.toMatchObject({ state: 'running' })
    await expect(listenNativeCameraLandmarks(onLandmarks)).resolves.toBe(unlisten)

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'start_native_camera_prototype',
      'get_native_camera_status',
      'set_native_camera_preview',
      'stop_native_camera_prototype',
    ])
    expect(invoke).toHaveBeenCalledWith('set_native_camera_preview', {
      bounds: {
        x: 10, y: 20, width: 160, height: 120, viewportHeight: 800,
        visible: true, cornerRadius: 8,
      },
    })
    expect(listen).toHaveBeenCalledWith('native-camera-landmarks', expect.any(Function))
    expect(onLandmarks).toHaveBeenCalledWith(expect.objectContaining({ frameSequence: 7 }))
  })
})
