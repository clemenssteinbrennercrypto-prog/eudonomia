export const CAMERA_FRAME_MS = 67
export const CAMERA_MUTE_GRACE_MS = 1200

export function streamHasLiveVideo(stream) {
  if (!stream?.getVideoTracks) return false
  return stream.getVideoTracks().some(track =>
    track.readyState === 'live' && track.enabled !== false && track.muted !== true
  )
}

export function createCameraController(videoEl, {
  width,
  height,
  onFrame,
  onTrackLost,
  getUserMedia = constraints => navigator.mediaDevices.getUserMedia(constraints),
  frameMs = CAMERA_FRAME_MS,
  muteGraceMs = CAMERA_MUTE_GRACE_MS,
}) {
  let stream = null
  let timer = null
  let muteTimer = null
  let stopped = false
  let inFlight = false
  let inactiveReported = false

  const reportTrackLoss = reason => {
    if (stopped) return
    onTrackLost(reason)
  }

  const pump = () => {
    if (stopped) return
    timer = setTimeout(pump, frameMs)
    const track = stream?.getVideoTracks?.()[0]
    if (track?.enabled === false || track?.readyState === 'ended') {
      if (!inactiveReported) {
        inactiveReported = true
        reportTrackLoss(track.readyState === 'ended' ? 'ended' : 'disabled')
      }
      return
    }
    if (inFlight || videoEl.readyState < 2 || !streamHasLiveVideo(stream)) return
    inFlight = true
    Promise.resolve(onFrame()).catch(() => {}).finally(() => { inFlight = false })
  }

  const watchTrack = track => {
    track.addEventListener('ended', () => reportTrackLoss('ended'))
    track.addEventListener('mute', () => {
      if (stopped || muteTimer) return
      muteTimer = setTimeout(() => {
        muteTimer = null
        if (!stopped && (track.muted || track.readyState !== 'live')) reportTrackLoss('muted')
      }, muteGraceMs)
    })
    track.addEventListener('unmute', () => {
      if (muteTimer) { clearTimeout(muteTimer); muteTimer = null }
    })
  }

  return {
    async start() {
      // A controller is single-use. A stopped/ended stream is never assigned
      // back to the video element; recovery always creates another controller
      // and performs another getUserMedia request.
      if (stopped) return false
      const acquired = await getUserMedia({ video: { width, height } })
      if (stopped) {
        acquired.getTracks().forEach(track => track.stop())
        return false
      }
      if (!streamHasLiveVideo(acquired)) {
        acquired.getTracks().forEach(track => track.stop())
        reportTrackLoss('ended')
        return false
      }
      stream = acquired
      videoEl.srcObject = stream
      stream.getVideoTracks().forEach(watchTrack)
      try { await videoEl.play() } catch {}
      pump()
      return true
    },
    stop() {
      stopped = true
      if (timer) { clearTimeout(timer); timer = null }
      if (muteTimer) { clearTimeout(muteTimer); muteTimer = null }
      try { videoEl.pause() } catch {}
      if (stream) stream.getTracks().forEach(track => track.stop())
      if (videoEl.srcObject === stream) videoEl.srcObject = null
      stream = null
    },
    diagnostics() {
      const track = stream?.getVideoTracks?.()[0] || null
      return {
        hasStream: Boolean(stream),
        readyState: track?.readyState || null,
        muted: track?.muted ?? null,
        enabled: track?.enabled ?? null,
        videoReadyState: videoEl.readyState,
        hasSrcObject: Boolean(videoEl.srcObject),
      }
    },
  }
}
