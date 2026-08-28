import { describe, expect, it, vi } from 'vitest'
import { attachSessionWindowLifecycle } from './sessionWindowLifecycle'

function harness() {
  const documentTarget = new EventTarget()
  documentTarget.visibilityState = 'visible'
  const windowTarget = new EventTarget()
  let nativeListener = () => {}
  const callbacks = {
    onBlur: vi.fn(),
    onSuspend: vi.fn(),
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
    expect(h.onSuspend).not.toHaveBeenCalled()
    h.windowTarget.dispatchEvent(new Event('focus'))
    expect(h.onVisible).toHaveBeenCalledWith('focus')
    h.detach()
  })

  it('treats another macOS Space like ordinary focus loss while still visible', () => {
    const h = harness()
    h.documentTarget.visibilityState = 'visible'
    h.windowTarget.dispatchEvent(new Event('blur'))
    expect(h.onBlur).toHaveBeenCalledWith('blur')
    expect(h.onSuspend).not.toHaveBeenCalled()
    h.detach()
  })

  it('suspends for a hidden or minimised WebView and wakes when visible', () => {
    const h = harness()
    h.documentTarget.visibilityState = 'hidden'
    h.documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(h.onSuspend).toHaveBeenCalledWith('hidden')
    h.documentTarget.visibilityState = 'visible'
    h.documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(h.onVisible).toHaveBeenCalledWith('visibility')
    h.detach()
  })

  it('uses native close/reopen events as explicit suspension boundaries', () => {
    const h = harness()
    h.native({ state: 'hidden', reason: 'close' })
    expect(h.onSuspend).toHaveBeenCalledWith('close')
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
