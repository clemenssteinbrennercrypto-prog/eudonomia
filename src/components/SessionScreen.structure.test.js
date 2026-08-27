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
    const background = source.indexOf('const onBackground = () => {')
    const pause = source.indexOf('isPausedRef.current = true', background)
    const blocking = source.indexOf("pushBlockingState(false, 'paused')", background)
    expect(background).toBeGreaterThan(-1)
    expect(pause).toBeGreaterThan(background)
    expect(blocking).toBeGreaterThan(pause)
    expect(source).toContain("session.sessionState === 'active' && backgroundedAtSecondRef.current != null")
  })

  it('requests a screen wake lock while the session status is mounted', () => {
    expect(source).toContain("navigator.wakeLock.request('screen')")
  })
})
