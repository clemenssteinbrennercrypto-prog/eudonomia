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

  it('pauses immediately when the WebView is backgrounded instead of timing unmeasured time', () => {
    const background = source.indexOf('const onBackground = (')
    const wake = source.indexOf('const onWake = () => {', background)
    const handler = source.slice(background, wake)
    expect(background).toBeGreaterThan(-1)
    expect(handler).toContain('void pauseSession()')
    expect(handler).toContain('setCameraSuspended(true)')
    expect(source).toContain("session.sessionState === 'active' &&")
    expect(source).toContain('backgroundedAtSecondRef.current != null || explicitResumeRequiredRef.current || !cameraReadyRef.current')
  })

  it('treats blur, hidden, close and reopen as explicit lifecycle paths', () => {
    expect(source).toContain("window.addEventListener('blur', onBlur)")
    expect(source).toContain("document.addEventListener('visibilitychange', onVisibilityChange)")
    expect(source).toContain("if (event.state === 'hidden') onBackground({ suspendCamera: true })")
    expect(source).toContain('setCameraSuspended(false)')
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
