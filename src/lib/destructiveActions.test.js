import { describe, expect, it } from 'vitest'
import { isInteractiveTarget, isTypingTarget, sessionShortcutAction } from './destructiveActions'

const target = (tagName, extra = {}) => ({ tagName, ...extra })

describe('destructive-action keyboard semantics', () => {
  it('does not steal shortcuts from fields or controls', () => {
    expect(isTypingTarget(target('input'))).toBe(true)
    expect(isTypingTarget(target('div', { isContentEditable: true }))).toBe(true)
    expect(isInteractiveTarget(target('button'))).toBe(true)
    expect(sessionShortcutAction({ key: 'Escape', target: target('input'), endConfirmationOpen: false, sessionPlanOpen: false })).toBeNull()
    expect(sessionShortcutAction({ key: ' ', target: target('button'), endConfirmationOpen: false, sessionPlanOpen: false })).toBeNull()
  })

  it('requires confirmation before Escape ends a session', () => {
    expect(sessionShortcutAction({ key: 'Escape', target: target('main'), endConfirmationOpen: false, sessionPlanOpen: false })).toBe('request-end-confirmation')
    expect(sessionShortcutAction({ key: 'Escape', target: target('main'), endConfirmationOpen: true, sessionPlanOpen: false })).toBe('cancel-end-confirmation')
  })

  it('closes the plan before offering to end the session', () => {
    expect(sessionShortcutAction({ key: 'Escape', target: target('main'), endConfirmationOpen: false, sessionPlanOpen: true })).toBe('close-session-plan')
    expect(sessionShortcutAction({ key: 'p', target: target('main'), endConfirmationOpen: true, sessionPlanOpen: false })).toBeNull()
  })
})
