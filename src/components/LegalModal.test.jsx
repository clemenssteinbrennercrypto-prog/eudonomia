import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import LegalModal from './LegalModal'

function html(tab = 'datenschutz') {
  return renderToString(React.createElement(LegalModal, {
    open: true,
    initialTab: tab,
    onClose() {},
  })).replaceAll('<!-- -->', '')
}

describe('legal copy', () => {
  it('does not present the incomplete address as a geographic address', () => {
    const output = html('impressum')
    expect(output).toContain('Straße, Hausnummer, PLZ und Ort ergänzen')
    expect(output).not.toContain('Adresse: Wien, Österreich')
  })

  it('describes the native store and the reachable deletion route', () => {
    const output = html()
    expect(output).toContain('lokalen SQLite-Datenbank')
    expect(output).toContain('Analytics → Sessions')
    expect(output).toContain('Clear all history')
    expect(output).toContain('Fenstertitel')
  })

  it('describes transient camera processing without denying the in-memory frame buffer', () => {
    const output = html()
    expect(output).toContain('kurzzeitig im Arbeitsspeicher verarbeitet')
    expect(output).toContain('weder dauerhaft gespeichert noch übertragen')
    expect(output).not.toContain('nicht gespeichert, gepuffert oder übertragen')
  })

  it('exposes the full-screen legal view as a labelled modal with tabs', () => {
    const output = html()
    expect(output).toContain('role="dialog"')
    expect(output).toContain('aria-modal="true"')
    expect(output).toContain('aria-labelledby=')
    expect(output).toContain('role="tablist"')
    expect(output).toContain('role="tab"')
  })

  it('names the actual provider labels and update behavior', () => {
    const output = html()
    expect(output).toContain('„Local model“')
    expect(output).toContain('„Claude API“')
    expect(output).toContain('ungefähr alle fünf Minuten')
    expect(output).toContain('GitHub Releases')
    expect(output).toContain('Cloud-Aufruf scheitert')
  })
})
