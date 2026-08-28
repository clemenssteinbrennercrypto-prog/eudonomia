export function canApplyCompanionActive({ explicitResumeRequired, cameraReady }) {
  return !explicitResumeRequired && cameraReady
}

export function attachSessionWindowLifecycle({
  documentTarget,
  windowTarget,
  listenNative,
  onBlur,
  onHidden,
  onVisible,
}) {
  let disposed = false
  let unlistenNative = () => {}

  const handleVisibilityChange = () => {
    if (documentTarget.visibilityState === 'visible') onVisible('visibility')
    else onHidden('hidden')
  }
  const handleBlur = () => onBlur('blur')
  const handleFocus = () => {
    if (documentTarget.visibilityState === 'visible') onVisible('focus')
  }

  documentTarget.addEventListener('visibilitychange', handleVisibilityChange)
  windowTarget.addEventListener('blur', handleBlur)
  windowTarget.addEventListener('focus', handleFocus)

  Promise.resolve(listenNative(event => {
    if (event.state === 'hidden') onHidden(event.reason || 'close')
    else if (event.state === 'visible') onVisible(event.reason || 'reopen')
  })).then(stop => {
    if (disposed) stop()
    else unlistenNative = stop
  })

  return () => {
    disposed = true
    documentTarget.removeEventListener('visibilitychange', handleVisibilityChange)
    windowTarget.removeEventListener('blur', handleBlur)
    windowTarget.removeEventListener('focus', handleFocus)
    unlistenNative()
  }
}
