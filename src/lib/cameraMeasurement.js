export const WEBVIEW_CAMERA_MEASUREMENT = Object.freeze({
  id: 'webview_mediapipe_v1',
  attentionScoringVersion: 1,
})

export const NATIVE_CAMERA_MEASUREMENT_V2 = Object.freeze({
  id: 'native_mediapipe_v2',
  attentionScoringVersion: 2,
  modelPackage: '@mediapipe/face_mesh@0.4.1633559619',
  landmarkModelSha256: '883b7411747bac657c30c462d305d312e9dec6adbf8b85e2f5d8d722fca9455d',
  detectorModelSha256: '3bc182eb9f33925d9e58b5c8d59308a760f4adea8f282370e428c51212c26633',
})

export const NATIVE_CAMERA_V2_PREFERENCE_KEY = 'eudaimonia_native_camera_v2'

export function nativeCameraV2Available({
  dev = import.meta.env.DEV,
  channel = import.meta.env.VITE_EUDONOMIA_BUILD_CHANNEL,
  nativeInvoke = globalThis.window?.__TAURI__?.core?.invoke,
} = {}) {
  return Boolean(nativeInvoke) && (dev === true || channel === 'test')
}

export function loadNativeCameraV2Enabled(options = {}) {
  if (!nativeCameraV2Available(options)) return false
  const storage = options.storage || globalThis.localStorage
  try {
    return storage?.getItem(NATIVE_CAMERA_V2_PREFERENCE_KEY) === 'on'
  } catch {
    return false
  }
}

export function saveNativeCameraV2Enabled(enabled, storage = globalThis.localStorage) {
  const next = Boolean(enabled)
  try {
    storage?.setItem(NATIVE_CAMERA_V2_PREFERENCE_KEY, next ? 'on' : 'off')
  } catch {}
  return next
}

export function cameraMeasurementProfile(nativeEnabled) {
  return nativeEnabled ? NATIVE_CAMERA_MEASUREMENT_V2 : WEBVIEW_CAMERA_MEASUREMENT
}

export function nativeCameraFaultFor(status) {
  if (status?.state !== 'faulted') return null
  switch (status.fault) {
    case 'no_frames': return 'no_frames'
    case 'capture': return 'no_camera'
    case 'inference':
    case 'architecture':
    case 'worker':
      return 'library'
    default:
      return 'stalled'
  }
}

export function nativeLandmarksForScoring(payload) {
  if (
    payload?.framePresent !== true ||
    !Number.isFinite(payload?.frameSequence) ||
    !Number.isFinite(payload?.capturedAtMs) ||
    payload.capturedAtMs <= 0
  ) return null
  if (payload.facePresent === false) return []
  if (payload.facePresent !== true || !Array.isArray(payload.landmarks) || payload.landmarks.length !== 478) {
    return null
  }
  return payload.landmarks.every(point =>
    Number.isFinite(point?.x) && Number.isFinite(point?.y) && Number.isFinite(point?.z))
    ? payload.landmarks
    : null
}
