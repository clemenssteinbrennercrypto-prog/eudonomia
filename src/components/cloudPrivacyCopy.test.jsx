import React from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import LegalModal from './LegalModal'
import SessionIntentScreen from './SessionIntentScreen'
import { CLOUD_GOAL_MAX_CHARS } from '../lib/intentContract'

// The cloud consent text is the legal basis for the one thing that leaves the
// device (Art. 6 Abs. 1 lit. a DSGVO), so it has to name a field the user can
// actually find. It once named a field "Ziel" that exists nowhere in the UI —
// the only plausible field a reader would map that onto is the session name,
// which is precisely the field that is never sent.

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
}

function readSource(name) {
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
}

const GOAL_FIELD_LABEL = 'Definition of plan'

describe('the cloud consent text describes a field the user can find', () => {
  const html = renderToString(
    React.createElement(LegalModal, { open: true, onClose() {}, initialTab: 'datenschutz' })
  ).replaceAll('<!-- -->', '')

  it('names the actual plan field rather than an invented one', () => {
    expect(html).toContain(GOAL_FIELD_LABEL)
    expect(html).not.toContain('Zielsatz')
    expect(html).not.toContain('Feld &quot;Ziel&quot;')
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
  const source = readSource('./FocusAppsScreen.jsx')

  it('names the plan field and the empty-field refusal', () => {
    expect(source).toContain(`typed into "${GOAL_FIELD_LABEL}" is sent to Anthropic`)
    expect(source).toContain('Leave that field empty')
  })

  it('reads the bound from the constant so the copy cannot drift from the code', () => {
    expect(source).toContain('{CLOUD_GOAL_MAX_CHARS} characters')
    expect(source).not.toMatch(/first 500 characters/)
  })
})

describe('the field the copy names is the field the session actually collects', () => {
  it('labels the goal input with the name both privacy texts use', () => {
    globalThis.localStorage = new MemoryStorage()
    const noop = () => {}
    const html = renderToString(React.createElement(SessionIntentScreen, {
      task: '', setTask: noop,
      goal: '', setGoal: noop,
      duration: 30, setDuration: noop,
      energyLevel: 'medium', setEnergyLevel: noop,
      tags: [], setTags: noop,
      onStart: noop,
    })).replaceAll('<!-- -->', '')
    expect(html).toContain(GOAL_FIELD_LABEL)
  })
})
