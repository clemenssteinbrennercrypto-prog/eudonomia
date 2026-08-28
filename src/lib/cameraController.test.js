import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCameraController, streamHasLiveVideo } from './cameraController'

class FakeTrack extends EventTarget {
  constructor() {
    super()
    this.readyState = 'live'
    this.muted = false
    this.enabled = true
    this.stop = vi.fn(() => { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')) })
  }
  end() { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')) }
  mute() { this.muted = true; this.dispatchEvent(new Event('mute')) }
}

function fakeStream(track = new FakeTrack()) {
  return { track, getTracks: () => [track], getVideoTracks: () => [track] }
}

function fakeVideo() {
  return { readyState: 4, srcObject: null, play: vi.fn(), pause: vi.fn() }
}

afterEach(() => vi.useRealTimers())

describe('camera stream validity', () => {
  it('requires a live, enabled and unmuted video track', () => {
    const stream = fakeStream()
    expect(streamHasLiveVideo(stream)).toBe(true)
    stream.track.muted = true
    expect(streamHasLiveVideo(stream)).toBe(false)
    stream.track.muted = false
    stream.track.enabled = false
    expect(streamHasLiveVideo(stream)).toBe(false)
    stream.track.enabled = true
    stream.track.readyState = 'ended'
    expect(streamHasLiveVideo(stream)).toBe(false)
  })
})

describe('camera controller lifecycle', () => {
  it('reports a track ending and never pumps the ended stream again', async () => {
    vi.useFakeTimers()
    const stream = fakeStream()
    const onFrame = vi.fn()
    const onTrackLost = vi.fn()
    const controller = createCameraController(fakeVideo(), {
      width: 320, height: 240, onFrame, onTrackLost,
      getUserMedia: vi.fn().mockResolvedValue(stream), frameMs: 10,
    })
    await controller.start()
    await vi.advanceTimersByTimeAsync(12)
    const framesBeforeEnd = onFrame.mock.calls.length
    expect(framesBeforeEnd).toBeGreaterThan(0)
    stream.track.end()
    await vi.advanceTimersByTimeAsync(50)
    expect(onTrackLost).toHaveBeenCalledWith('ended')
    expect(onFrame).toHaveBeenCalledTimes(framesBeforeEnd)
    controller.stop()
  })

  it('requires a new getUserMedia stream after interruption', async () => {
    const first = fakeStream()
    const second = fakeStream()
    const getUserMedia = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const firstVideo = fakeVideo()
    const firstController = createCameraController(firstVideo, {
      width: 320, height: 240, onFrame: vi.fn(), onTrackLost: vi.fn(), getUserMedia,
    })
    await firstController.start()
    first.track.end()
    firstController.stop()
    const secondVideo = fakeVideo()
    const secondController = createCameraController(secondVideo, {
      width: 320, height: 240, onFrame: vi.fn(), onTrackLost: vi.fn(), getUserMedia,
    })
    await secondController.start()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(secondVideo.srcObject).toBe(second)
    expect(secondVideo.srcObject).not.toBe(first)
    secondController.stop()
  })

  it('stops a stream acquired after unmount before assigning it', async () => {
    let resolveStream
    const pending = new Promise(resolve => { resolveStream = resolve })
    const stream = fakeStream()
    const video = fakeVideo()
    const controller = createCameraController(video, {
      width: 320, height: 240, onFrame: vi.fn(), onTrackLost: vi.fn(), getUserMedia: () => pending,
    })
    const start = controller.start()
    controller.stop()
    resolveStream(stream)
    await start
    expect(stream.track.stop).toHaveBeenCalledOnce()
    expect(video.srcObject).toBeNull()
  })

  it('turns a sustained mute into track loss', async () => {
    vi.useFakeTimers()
    const stream = fakeStream()
    const onTrackLost = vi.fn()
    const controller = createCameraController(fakeVideo(), {
      width: 320, height: 240, onFrame: vi.fn(), onTrackLost,
      getUserMedia: vi.fn().mockResolvedValue(stream), muteGraceMs: 20,
    })
    await controller.start()
    stream.track.mute()
    await vi.advanceTimersByTimeAsync(21)
    expect(onTrackLost).toHaveBeenCalledWith('muted')
    controller.stop()
  })

  it('reports a disabled track instead of silently stalling', async () => {
    vi.useFakeTimers()
    const stream = fakeStream()
    const onTrackLost = vi.fn()
    const controller = createCameraController(fakeVideo(), {
      width: 320, height: 240, onFrame: vi.fn(), onTrackLost,
      getUserMedia: vi.fn().mockResolvedValue(stream), frameMs: 10,
    })
    await controller.start()
    stream.track.enabled = false
    await vi.advanceTimersByTimeAsync(12)
    expect(onTrackLost).toHaveBeenCalledWith('disabled')
    controller.stop()
  })
})
