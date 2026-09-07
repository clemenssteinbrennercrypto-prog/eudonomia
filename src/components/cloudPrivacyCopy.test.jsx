import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import LegalModal from './LegalModal'
import SessionIntentScreen from './SessionIntentScreen'
import { CloudPrivacyNotice } from './FocusAppsScreen'
import { CLOUD_GOAL_MAX_CHARS } from '../lib/intentContract'

// The cloud consent text is the legal basis for the one thing that leaves the
// device (Art. 6 Abs. 1 lit. a DSGVO), so it has to name a field the user can
// actually find. It once named a field "Ziel" that exists nowhere in the UI —
// the only plausible field a reader would map that onto is the session name,
// which is precisely the field that is never sent.

const GOAL_FIELD_LABEL = 'Definition of plan'

describe('the cloud consent text describes a field the user can find', () => {
  const html = renderToString(
    React.createElement(LegalModal, { open: true, onClose() {}, initialTab: 'datenschutz' })
  ).replaceAll('<!-- -->', '')

  it('names the actual plan field rather than an invented one', () => {
    expect(html).toContain(GOAL_FIELD_LABEL)
    expect(html).not.toContain('Zielsatz')
    expect(html).not.toContain('Feld &quot;Ziel&quot;')
    expect(html).not.toContain('Ihr eingegebenes Ziel')
  })

  it('states the character bound that the code actually applies', () => {
    expect(html).toContain(`${CLOUD_GOAL_MAX_CHARS} Zeichen`)
  })

  it('states that an empty plan field transmits nothing', () => {
    expect(html).toContain('ist das Feld leer, wird nichts übermittelt')
  })

  it('still rules out the session name, tags and session evidence', () => {
    expect(html).toContain('Sessionname, Tags, Aktivitätsprotokolle, Sitzungsdaten, Fenstertitel und Dateinamen')
    expect(html).toContain('die Sitzungsbewertung bleibt lokal')
  })
})

describe('the provider settings copy matches the same boundary', () => {
  const html = renderToString(React.createElement(CloudPrivacyNotice)).replaceAll('<!-- -->', '')

  it('names the plan field and the empty-field refusal', () => {
    expect(html).toContain(`typed into &quot;${GOAL_FIELD_LABEL}&quot; is sent to Anthropic`)
    expect(html).toContain('Leave that field empty')
  })

  it('renders the bound from the transport constant', () => {
    expect(html).toContain(`first ${CLOUD_GOAL_MAX_CHARS} characters`)
  })
})

describe('the field the copy names is the field the session actually collects', () => {
  it('labels the goal input with the name both privacy texts use', () => {
    const noop = () => {}
    const html = renderToString(React.createElement(SessionIntentScreen, {
      task: '', setTask: noop,
      goal: '', setGoal: noop,
      duration: 30, setDuration: noop,
      energyLevel: 'medium', setEnergyLevel: noop,
      tags: [], setTags: noop,
      contractProvider: 'cloud',
      onStart: noop,
    })).replaceAll('<!-- -->', '')
    expect(html).toContain(GOAL_FIELD_LABEL)
    expect(html).toContain(`first ${CLOUD_GOAL_MAX_CHARS} characters are sent to Anthropic`)
    expect(html).toContain('session name, tags and activity stay local')
  })
})
