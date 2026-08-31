import { describe, expect, it, vi } from 'vitest'
import {
  NATIVE_CAMERA_MEASUREMENT_V2,
  WEBVIEW_CAMERA_MEASUREMENT,
  cameraMeasurementProfile,
  loadNativeCameraV2Enabled,
  nativeCameraFaultFor,
  nativeLandmarksForScoring,
  nativeCameraV2Available,
  saveNativeCameraV2Enabled,
} from './cameraMeasurement'

describe('native camera V2 gate', () => {
  it('requires both a native runtime and an internal build', () => {
    const invoke = vi.fn()
    expect(nativeCameraV2Available({ dev: false, channel: 'test', nativeInvoke: invoke })).toBe(true)
    expect(nativeCameraV2Available({ dev: false, channel: 'release', nativeInvoke: invoke })).toBe(false)
    expect(nativeCameraV2Available({ dev: true, channel: '', nativeInvoke: null })).toBe(false)
  })

  it('is opt-in and cannot leak into a release build through local storage', () => {
    const storage = { getItem: vi.fn(() => 'on'), setItem: vi.fn() }
    expect(loadNativeCameraV2Enabled({
      dev: false,
      channel: 'release',
      nativeInvoke: vi.fn(),
      storage,
    })).toBe(false)
    expect(loadNativeCameraV2Enabled({
      dev: false,
      channel: 'test',
      nativeInvoke: vi.fn(),
      storage,
    })).toBe(true)
    expect(saveNativeCameraV2Enabled(false, storage)).toBe(false)
    expect(storage.setItem).toHaveBeenCalledWith('eudaimonia_native_camera_v2', 'off')
  })

  it('keeps native measurements in a distinct scoring generation', () => {
    expect(cameraMeasurementProfile(false)).toBe(WEBVIEW_CAMERA_MEASUREMENT)
    expect(cameraMeasurementProfile(true)).toBe(NATIVE_CAMERA_MEASUREMENT_V2)
    expect(NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion)
      .not.toBe(WEBVIEW_CAMERA_MEASUREMENT.attentionScoringVersion)
  })

  it('maps native failures to existing honest no-measurement states', () => {
    expect(nativeCameraFaultFor({ state: 'faulted', fault: 'no_frames' })).toBe('no_frames')
    expect(nativeCameraFaultFor({ state: 'faulted', fault: 'capture' })).toBe('no_camera')
    expect(nativeCameraFaultFor({ state: 'faulted', fault: 'inference' })).toBe('library')
    expect(nativeCameraFaultFor({ state: 'running', fault: null })).toBeNull()
  })

  it('refuses malformed IPC landmarks instead of treating them as a real frame', () => {
    const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
    expect(nativeLandmarksForScoring({
      framePresent: true, frameSequence: 1, capturedAtMs: 100, facePresent: true, landmarks,
    })).toBe(landmarks)
    expect(nativeLandmarksForScoring({
      framePresent: true, frameSequence: 2, capturedAtMs: 200, facePresent: false, landmarks: null,
    })).toEqual([])
    expect(nativeLandmarksForScoring({
      framePresent: true, frameSequence: 3, capturedAtMs: 300, facePresent: true, landmarks: landmarks.slice(1),
    })).toBeNull()
    expect(nativeLandmarksForScoring({
      framePresent: true,
      frameSequence: 4,
      capturedAtMs: 400,
      facePresent: true,
      landmarks: landmarks.map((point, index) => index === 100 ? { ...point, x: NaN } : point),
    })).toBeNull()
    expect(nativeLandmarksForScoring({
      framePresent: true, frameSequence: 5, facePresent: false, landmarks: null,
    })).toBeNull()
  })
})
