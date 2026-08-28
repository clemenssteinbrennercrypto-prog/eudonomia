import { describe, expect, it, vi } from 'vitest'
import { attachSessionWindowLifecycle, canApplyCompanionActive } from './sessionWindowLifecycle'

describe('companion resume gate', () => {
  it('allows resume during ordinary blur when the camera remains healthy', () => {
    expect(canApplyCompanionActive({ explicitResumeRequired: false, cameraReady: true })).toBe(true)
  })

  it('rejects resume after suspension until a fresh frame and explicit confirmation', () => {
    expect(canApplyCompanionActive({ explicitResumeRequired: true, cameraReady: true })).toBe(false)
    expect(canApplyCompanionActive({ explicitResumeRequired: false, cameraReady: false })).toBe(false)
  })
})

function harness() {
  const documentTarget = new EventTarget()
  documentTarget.visibilityState = 'visible'
  const windowTarget = new EventTarget()
  let nativeListener = () => {}
  const callbacks = {
    onBlur: vi.fn(),
    onHidden: vi.fn(),
    onVisible: vi.fn(),
  }
  const detach = attachSessionWindowLifecycle({
    documentTarget,
    windowTarget,
    listenNative: vi.fn(listener => {
      nativeListener = listener
      return () => {}
    }),
    ...callbacks,
  })
  return { documentTarget, windowTarget, native: event => nativeListener(event), detach, ...callbacks }
}

describe('session window lifecycle', () => {
  it('treats an ordinary app switch as blur, not camera suspension', () => {
    const h = harness()
    h.windowTarget.dispatchEvent(new Event('blur'))
    expect(h.onBlur).toHaveBeenCalledOnce()
    expect(h.onHidden).not.toHaveBeenCalled()
    h.windowTarget.dispatchEvent(new Event('focus'))
    expect(h.onVisible).toHaveBeenCalledWith('focus')
    h.detach()
  })

  it('treats another macOS Space like ordinary focus loss while still visible', () => {
    const h = harness()
    h.documentTarget.visibilityState = 'visible'
    h.windowTarget.dispatchEvent(new Event('blur'))
    expect(h.onBlur).toHaveBeenCalledWith('blur')
    expect(h.onHidden).not.toHaveBeenCalled()
    h.detach()
  })

  it('reports a hidden or minimised WebView without deciding session state', () => {
    const h = harness()
    h.documentTarget.visibilityState = 'hidden'
    h.documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(h.onHidden).toHaveBeenCalledWith('hidden')
    h.documentTarget.visibilityState = 'visible'
    h.documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(h.onVisible).toHaveBeenCalledWith('visibility')
    h.detach()
  })

  it('reports native close/reopen without deciding camera ownership', () => {
    const h = harness()
    h.native({ state: 'hidden', reason: 'close' })
    expect(h.onHidden).toHaveBeenCalledWith('close')
    h.native({ state: 'visible', reason: 'reopen' })
    expect(h.onVisible).toHaveBeenCalledWith('reopen')
    h.detach()
  })

  it('removes browser listeners on unmount', () => {
    const h = harness()
    h.detach()
    h.windowTarget.dispatchEvent(new Event('blur'))
    h.windowTarget.dispatchEvent(new Event('focus'))
    expect(h.onBlur).not.toHaveBeenCalled()
    expect(h.onVisible).not.toHaveBeenCalled()
  })
})
