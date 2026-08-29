export const CAMERA_FRAME_MS = 67
export const CAMERA_MUTE_GRACE_MS = 1200
// A live track is not proof of a live picture. When macOS/WebKit stops
// decoding into an off-screen <video> (window minimized or the app napped),
// the track stays 'live' and readyState stays >= 2 while currentTime stops
// advancing — the element keeps handing out the SAME frozen frame. Feeding
// that to MediaPipe produces identical landmarks forever, which reads as a
// perfectly steady score for a user who may have walked away. Treat a
// picture that has not advanced for this long as no picture at all.
export const CAMERA_STALE_FRAME_MS = 1000

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
  // Called with true when the decoded picture freezes and false when it
  // resumes. This is NOT a fault: the caller must withhold measurement but
  // must not rebuild the stream or pause the user's session for it.
  onPictureSuspended = () => {},
  getUserMedia = constraints => navigator.mediaDevices.getUserMedia(constraints),
  frameMs = CAMERA_FRAME_MS,
  muteGraceMs = CAMERA_MUTE_GRACE_MS,
  staleFrameMs = CAMERA_STALE_FRAME_MS,
  now = () => Date.now(),
}) {
  let stream = null
  let timer = null
  let muteTimer = null
  let stopped = false
  let inFlight = false
  let inactiveReported = false
  let lastPictureTime = null   // videoEl.currentTime of the last distinct frame
  let lastAdvanceAt = 0        // when that frame first appeared
  let pictureSuspended = false // last reported suspension state

  const reportTrackLoss = reason => {
    if (stopped) return
    onTrackLost(reason)
  }

  // True once the decoded picture has been frozen longer than staleFrameMs.
  // Deliberately silent: this is not track loss (the hardware is fine and the
  // picture resumes by itself when the window is visible again), so it must
  // not trigger a reconnect. It only withholds the frame, which lets the
  // session's own frame-heartbeat mark the span as unmeasured rather than
  // scoring a still image.
  const isPictureStale = () => {
    const pictureTime = videoEl.currentTime
    // No usable clock (test doubles, an element that never reports one):
    // fall back to the previous behaviour rather than blocking every frame.
    if (typeof pictureTime !== 'number' || !Number.isFinite(pictureTime)) return false
    const at = now()
    if (pictureTime !== lastPictureTime) {
      lastPictureTime = pictureTime
      lastAdvanceAt = at
      return false
    }
    if (!lastAdvanceAt) {          // first observation is never stale
      lastAdvanceAt = at
      return false
    }
    return at - lastAdvanceAt > staleFrameMs
  }

  // Report only the transitions, so the session can withhold measurement
  // without a fault and pick it back up the moment the picture moves again.
  const syncSuspendedState = stale => {
    if (stale === pictureSuspended) return
    pictureSuspended = stale
    if (!stopped) onPictureSuspended(stale)
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
    const stale = isPictureStale()
    syncSuspendedState(stale)
    if (stale) return
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
      // A fresh stream restarts the picture clock; never judge it against
      // the previous stream's timestamps.
      lastPictureTime = null
      lastAdvanceAt = 0
      pictureSuspended = false
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
        pictureTime: videoEl.currentTime ?? null,
        // Read-only: must never advance the staleness clock that pump owns.
        pictureStale: Boolean(lastAdvanceAt) &&
          videoEl.currentTime === lastPictureTime &&
          now() - lastAdvanceAt > staleFrameMs,
      }
    },
  }
}
