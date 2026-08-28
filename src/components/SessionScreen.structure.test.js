import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./SessionScreen.jsx', import.meta.url), 'utf8')

describe('SessionScreen accumulation wiring', () => {
  it('uses the shared accumulator in both the timer tick and final flush', () => {
    expect(source.match(/accumulateMeasurement\(\{/g)).toHaveLength(2)
    expect(source).toContain('forceTimelineSample: true')
  })

  it('stops a finished session before the tick can touch camera health', () => {
    const tickStart = source.indexOf('const tick = setInterval(() => {')
    const guard = source.indexOf('if (sessionEndedRef.current) return', tickStart)
    const cameraHealth = source.indexOf('// ── Camera health', tickStart)
    expect(tickStart).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(tickStart)
    expect(guard).toBeLessThan(cameraHealth)
  })

  it('keeps a healthy camera and session active during an ordinary blur', () => {
    const blur = source.indexOf('const onBlur = () => {')
    const suspend = source.indexOf('const onSuspend = () => {', blur)
    const handler = source.slice(blur, suspend)
    expect(blur).toBeGreaterThan(-1)
    expect(handler).not.toContain('pauseSession')
    expect(handler).not.toContain('restartCamera')
    expect(handler).not.toContain('setCameraSuspended')
    expect(handler).not.toContain('backgroundedAtSecondRef')
    expect(handler).not.toContain('timerThrottlingIntervalsRef')
  })

  it('pauses and tears down the camera only on a real suspension boundary', () => {
    const suspend = source.indexOf('const onSuspend = () => {')
    const closeInterval = source.indexOf('const closeBackgroundInterval', suspend)
    const handler = source.slice(suspend, closeInterval)
    expect(handler).toContain('void pauseSession()')
    expect(handler).toContain('interruptCamera()')
    expect(handler).toContain('setCameraSuspended(true)')
    expect(source).toContain("session.sessionState === 'active' && !canApplyCompanionActive")
  })

  it('only reconnects on focus after suspension or a stale heartbeat', () => {
    const wake = source.indexOf('const onWake = () => {')
    const attach = source.indexOf('return attachSessionWindowLifecycle', wake)
    const handler = source.slice(wake, attach)
    expect(handler).toContain('if (cameraSuspendedRef.current)')
    expect(handler).toContain('Date.now() - lastFrame > CAMERA_RECOVER_MS')
    expect(handler.match(/restartCamera\(true\)/g)).toHaveLength(2)
  })

  it('does not resume until the new MediaPipe generation delivered a frame', () => {
    expect(source).toContain('generation !== cameraGenerationRef.current')
    expect(source).toContain("setCameraStatus('ready')")
    expect(source).toContain('!cameraReadyRef.current || Date.now() - lastDeliveredFrameAtRef.current > CAMERA_RECOVER_MS')
  })

  it('pauses timer accumulation on a camera fault', () => {
    const faultBranch = source.indexOf('if (cameraFaultRef.current) {')
    const calibrationBranch = source.indexOf('if (calibrating) {', faultBranch)
    expect(source.slice(faultBranch, calibrationBranch)).toContain('interruptCamera(cameraFaultRef.current)')
  })

  it('requests a screen wake lock while the session status is mounted', () => {
    expect(source).toContain("navigator.wakeLock.request('screen')")
  })
})
