import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import WorkspaceManager from './WorkspaceManager'
import { emptyWorkspaceState, migrateLegacyDevices } from '../lib/workspaceStore'

describe('WorkspaceManager', () => {
  it('requires a visual template when no workspace exists', () => {
    const html = renderToStaticMarkup(<WorkspaceManager state={emptyWorkspaceState()} onChange={() => ({ ok: true })} onContinue={() => {}} />)
    expect(html).toContain('Build the desk Eudaimonia will understand.')
    expect(html).toContain('Use quick question setup instead')
  })

  it('renders a migrated active workspace in the reusable library', () => {
    const state = migrateLegacyDevices([
      { id: 'monitor', type: 'monitor', col: .5, row: .5, role: 'primary_screen' },
      { id: 'camera', type: 'camera', col: .5, row: .1, role: 'neutral' },
    ])
    const html = renderToStaticMarkup(<WorkspaceManager state={state} onChange={() => ({ ok: true })} onContinue={() => {}} />)
    expect(html).toContain('Imported workspace')
    expect(html).toContain('Active')
  })
})
