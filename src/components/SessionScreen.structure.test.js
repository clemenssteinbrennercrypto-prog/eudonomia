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

  it('keeps the session active while another work app has window focus', () => {
    const background = source.indexOf('const onBackground = () => {')
    const closeBackground = source.indexOf('const closeBackgroundInterval = () => {', background)
    const handler = source.slice(background, closeBackground)
    expect(background).toBeGreaterThan(-1)
    expect(handler).toContain('backgroundedAtSecondRef.current = elapsedSecond(Date.now())')
    expect(handler).not.toContain('isPausedRef.current = true')
    expect(handler).not.toContain("pushBlockingState(false, 'paused')")
  })

  it('requests a screen wake lock while the session status is mounted', () => {
    expect(source).toContain("navigator.wakeLock.request('screen')")
  })
})
