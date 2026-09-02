import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Onboarding.jsx'), 'utf8')

describe('onboarding camera handoff', () => {
  it('does not persist onboarding merely when getUserMedia resolves', () => {
    const enableStart = source.indexOf('const handleEnableCamera')
    const enableEnd = source.indexOf('// The way out.', enableStart)
    const enableBlock = source.slice(enableStart, enableEnd)
    expect(enableBlock).toContain('navigator.mediaDevices.getUserMedia')
    expect(enableBlock).not.toContain("localStorage.setItem('eudaimonia_onboarded', 'true')")
    expect(source).toContain('prepareCameraPreview(v, stream')
    expect(source).toContain("setAwakenPhase('locked')")
  })

  it('keeps a visible success state and uses truthful readiness copy', () => {
    expect(source).toContain("setAwakenPhase('locked')")
    expect(source).toContain('Live preview is ready.')
    expect(source).toContain('Attention measurement begins when a session starts.')
    expect(source).not.toContain("You're locked in.")
    expect(source).not.toContain('can see your focus now')
    expect(source).toContain('awakenPhase === \'locked\'')
    expect(source).toContain('onClick={completeOnboarding}')
  })

  // These stay source-level on purpose: the repo has no DOM test environment,
  // so an internal-state screen like the awakening cannot be driven. The
  // decision that was actually wrong here — cancellation vs. a real camera
  // error — lives in cameraReadiness.js and is covered behaviourally there.
  it('never treats a failure as a cancellation by error name alone', () => {
    expect(source).toContain('isReadinessCancellation(error, controller.signal)')
    expect(source).not.toContain("error?.name === 'AbortError'")
  })

  it('announces the readiness outcome and moves focus to the way forward', () => {
    expect(source).toContain('role="status" aria-live="polite"')
    expect(source).toContain('role="alert"')
    expect(source).toContain('ref={awakenActionRef}')
    expect(source).toContain('awakenActionRef.current?.focus()')
  })

  it('offers explicit camera retry and explicit skip, both with cleanup', () => {
    expect(source).toContain('Try camera again')
    expect(source).toContain('Continue without camera')
    expect(source).toContain('const handleRetryCamera')
    expect(source).toContain('releaseCameraStream(streamRef.current, videoRef.current)')
    expect(source).toContain('localStorage.setItem(\'eudaimonia_onboarded\', \'true\')')
  })
})
