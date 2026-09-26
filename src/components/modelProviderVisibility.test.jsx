import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import LegalModal from './LegalModal'
import SessionIntentScreen from './SessionIntentScreen'
import FocusAppsScreen from './FocusAppsScreen'
import { normalizeProtectionState } from '../lib/protectionSetups'

function renderIntent() {
  const noop = () => {}
  return renderToString(React.createElement(SessionIntentScreen, {
    task: '', setTask: noop,
    goal: '', setGoal: noop,
    duration: 30, setDuration: noop,
    energyLevel: 'medium', setEnergyLevel: noop,
    tags: [], setTags: noop,
    onStart: noop,
  })).replaceAll('<!-- -->', '')
}

describe('optional model providers stay out of the public product', () => {
  it('does not offer model-provider controls on Protection', () => {
    const html = renderToString(React.createElement(FocusAppsScreen, {
      onBack() {},
      focusModeEnabled: false,
      setFocusModeEnabled() {},
      protectionState: normalizeProtectionState(null),
    })).replaceAll('<!-- -->', '')

    expect(html).not.toContain('Goal understanding')
    expect(html).not.toContain('Local model')
    expect(html).not.toContain('Claude API')
    expect(html).not.toContain('Advanced')
  })

  it('does not present dormant cloud behavior in session planning', () => {
    const html = renderIntent()
    expect(html).toContain('Definition of plan')
    expect(html).not.toContain('Anthropic')
    expect(html).not.toContain('Cloud active')
  })

  it('does not describe a disabled provider as an available data transfer', () => {
    const html = renderToString(
      React.createElement(LegalModal, { open: true, onClose() {}, initialTab: 'datenschutz' })
    ).replaceAll('<!-- -->', '')

    expect(html).not.toContain('Claude API')
    expect(html).not.toContain('Local model')
    expect(html).not.toContain('Anthropic')
    expect(html).not.toContain('Zielverständnis per Sprachmodell')
  })
})
