const DEFAULT_TIMEOUT_MS = 6000
const DEFAULT_REQUIRED_ADVANCES = 2
const POLL_INTERVAL_MS = 50

export class CameraReadinessError extends Error {
  constructor(message, code = 'camera_readiness_failed') {
    super(message)
    this.name = 'CameraReadinessError'
    this.code = code
  }
}

function abortError() {
  const error = new Error('Camera readiness check was cancelled.')
  error.name = 'AbortError'
  return error
}

/**
 * Resolve only after a visible video has presented multiple advancing frames.
 * This checks presentation readiness; it does not inspect a face or measure
 * attention. requestVideoFrameCallback is the strongest available browser
 * signal, with currentTime polling retained for older WebViews.
 */
export function waitForAdvancingVideoFrames(video, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  requiredAdvances = DEFAULT_REQUIRED_ADVANCES,
  signal,
} = {}) {
  if (!video) {
    return Promise.reject(new CameraReadinessError('The camera preview is unavailable.', 'preview_unavailable'))
  }

  return new Promise((resolve, reject) => {
    let settled = false
    let lastMediaTime = null
    let advances = 0
    let scheduledId = null
    let scheduledWithVideoCallback = false

    const cleanup = () => {
      clearTimeout(timeoutId)
      if (scheduledId !== null) {
        if (scheduledWithVideoCallback && typeof video.cancelVideoFrameCallback === 'function') {
          video.cancelVideoFrameCallback(scheduledId)
        } else {
          clearTimeout(scheduledId)
        }
      }
      signal?.removeEventListener('abort', onAbort)
    }

    const settle = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }

    const onAbort = () => settle(reject, abortError())

    const inspectFrame = (_now, metadata) => {
      scheduledId = null
      if (settled) return

      const mediaTime = Number.isFinite(metadata?.mediaTime)
        ? metadata.mediaTime
        : Number(video.currentTime)
      const dimensionsReady = Number(video.videoWidth) > 0 && Number(video.videoHeight) > 0

      if (dimensionsReady && Number.isFinite(mediaTime)) {
        if (lastMediaTime !== null && mediaTime > lastMediaTime) advances += 1
        if (lastMediaTime === null || mediaTime > lastMediaTime) lastMediaTime = mediaTime
      }

      if (advances >= requiredAdvances) {
        settle(resolve, { advances, mediaTime })
        return
      }

      scheduleNext()
    }

    const scheduleNext = () => {
      if (settled) return
      if (typeof video.requestVideoFrameCallback === 'function') {
        scheduledWithVideoCallback = true
        scheduledId = video.requestVideoFrameCallback(inspectFrame)
      } else {
        scheduledWithVideoCallback = false
        scheduledId = setTimeout(() => inspectFrame(), POLL_INTERVAL_MS)
      }
    }

    const timeoutId = setTimeout(() => {
      settle(reject, new CameraReadinessError(
        'The camera opened, but the preview did not produce advancing frames.',
        'no_advancing_frames',
      ))
    }, timeoutMs)

    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    scheduleNext()
  })
}

export async function prepareCameraPreview(video, stream, options) {
  if (!video || !stream) {
    throw new CameraReadinessError('The camera preview is unavailable.', 'preview_unavailable')
  }
  video.srcObject = stream
  await video.play()
  return waitForAdvancingVideoFrames(video, options)
}

export function releaseCameraStream(stream, video = null) {
  if (video?.srcObject === stream) {
    video.pause?.()
    video.srcObject = null
  }
  stream?.getTracks?.().forEach(track => track.stop())
}

export function cameraAccessFailureMessage(error) {
  const measurementWarning = 'Sessions cannot measure attention until camera access is fixed.'
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Camera access was denied. Allow Eudaimonia under System Settings › Privacy & Security › Camera, then come back. ${measurementWarning}`
    case 'NotReadableError':
    case 'AbortError':
      return `Another app may be using the camera. Quit Zoom, Teams, FaceTime, or Photo Booth and try again. ${measurementWarning}`
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `No camera was found. Connect one, then try again. ${measurementWarning}`
    default:
      return `The camera could not be started. Check camera access and try again. ${measurementWarning}`
  }
}

export function stalledCameraMessage() {
  return 'The camera opened, but no live frames arrived. Close any app using the camera, check System Settings › Privacy & Security › Camera, then try again. Sessions cannot measure attention until camera access is fixed.'
}
