import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cameraAccessFailureMessage,
  isReadinessCancellation,
  prepareCameraPreview,
  releaseCameraStream,
  stalledCameraMessage,
  waitForAdvancingVideoFrames,
} from './cameraReadiness'

function controlledVideo() {
  const callbacks = new Map()
  let nextId = 1
  const video = {
    srcObject: null,
    currentTime: 0,
    videoWidth: 640,
    videoHeight: 480,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    requestVideoFrameCallback: vi.fn(callback => {
      const id = nextId++
      callbacks.set(id, callback)
      return id
    }),
    cancelVideoFrameCallback: vi.fn(id => callbacks.delete(id)),
  }
  const present = mediaTime => {
    const [id, callback] = callbacks.entries().next().value
    callbacks.delete(id)
    callback(performance.now(), { mediaTime })
  }
  return { video, present }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('camera readiness', () => {
  it('declares success only after the visible preview presents advancing frames', async () => {
    const { video, present } = controlledVideo()
    const stream = { getTracks: () => [] }
    const readiness = prepareCameraPreview(video, stream, { timeoutMs: 1000 })

    await video.play.mock.results[0].value
    present(0)
    present(0.033)
    present(0.066)

    await expect(readiness).resolves.toMatchObject({ advances: 2, mediaTime: 0.066 })
    expect(video.srcObject).toBe(stream)
    expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(3)
  })

  it('gives denied permission an actionable explanation without implying measurement', () => {
    const message = cameraAccessFailureMessage({ name: 'NotAllowedError' })
    expect(message).toContain('System Settings › Privacy & Security › Camera')
    expect(message).toContain('Sessions cannot measure attention')
    expect(message).not.toMatch(/learn|calibrat|focus lock/i)
  })

  it('refuses success when presented frames are stalled', async () => {
    vi.useFakeTimers()
    const { video, present } = controlledVideo()
    const readiness = waitForAdvancingVideoFrames(video, { timeoutMs: 500 })
    const rejection = expect(readiness).rejects.toMatchObject({ code: 'no_advancing_frames' })

    present(1)
    present(1)
    present(1)
    await vi.advanceTimersByTimeAsync(500)

    await rejection
    expect(stalledCameraMessage()).toContain('no live frames arrived')
    expect(stalledCameraMessage()).toContain('Sessions cannot measure attention')
  })

  // A play() rejection is the failure this screen is most likely to hit in the
  // WebView, and it arrives named AbortError — the same name our own
  // cancellation uses. Conflating them leaves onboarding stuck on "Checking
  // your camera…" with no retry, no skip and the camera still held.
  it('surfaces a play() AbortError instead of mistaking it for a cancellation', async () => {
    const { video } = controlledVideo()
    const playAbort = Object.assign(new Error('The play() request was interrupted.'), { name: 'AbortError' })
    video.play = vi.fn().mockRejectedValue(playAbort)
    const controller = new AbortController()

    await expect(prepareCameraPreview(video, { getTracks: () => [] }, { signal: controller.signal }))
      .rejects.toBe(playAbort)
    expect(isReadinessCancellation(playAbort, controller.signal)).toBe(false)
    expect(cameraAccessFailureMessage(playAbort)).toContain('Sessions cannot measure attention')
  })

  it('recognises only its own cancellation, by signal and by code', async () => {
    const { video } = controlledVideo()
    const controller = new AbortController()
    const readiness = waitForAdvancingVideoFrames(video, { signal: controller.signal })

    controller.abort()
    const cancellation = await readiness.catch(error => error)

    expect(isReadinessCancellation(cancellation, controller.signal)).toBe(true)
    // The code alone identifies it, so a caller without the signal is safe too.
    expect(isReadinessCancellation(cancellation, undefined)).toBe(true)
    expect(isReadinessCancellation({ code: 'no_advancing_frames' }, undefined)).toBe(false)
    expect(isReadinessCancellation({ name: 'AbortError' }, undefined)).toBe(false)
  })

  it('cancels a pending frame check and stops every track during cleanup', async () => {
    const { video } = controlledVideo()
    const controller = new AbortController()
    const readiness = waitForAdvancingVideoFrames(video, { signal: controller.signal })
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }]
    const stream = { getTracks: () => tracks }
    video.srcObject = stream

    controller.abort()
    await expect(readiness).rejects.toMatchObject({ name: 'AbortError' })
    releaseCameraStream(stream, video)

    expect(video.cancelVideoFrameCallback).toHaveBeenCalledTimes(1)
    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
    expect(tracks.every(track => track.stop.mock.calls.length === 1)).toBe(true)
  })
})
