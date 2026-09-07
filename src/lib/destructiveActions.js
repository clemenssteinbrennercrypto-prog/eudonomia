export function isTypingTarget(target) {
  if (!target) return false
  const tagName = String(target.tagName || '').toUpperCase()
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || Boolean(target.isContentEditable)
}

export function isInteractiveTarget(target) {
  if (isTypingTarget(target)) return true
  const tagName = String(target?.tagName || '').toUpperCase()
  return tagName === 'BUTTON' || tagName === 'A'
}

export function sessionShortcutAction({ key, target, endConfirmationOpen, sessionPlanOpen }) {
  if (isInteractiveTarget(target)) return null

  if (key === 'Escape') {
    if (endConfirmationOpen) return 'cancel-end-confirmation'
    if (sessionPlanOpen) return 'close-session-plan'
    return 'request-end-confirmation'
  }
  if (endConfirmationOpen || sessionPlanOpen) return null
  if (key === ' ' || key === 'p') return 'toggle-pause'
  if (key === 'h') return 'toggle-camera'
  return null
}
