// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import WorkspaceManager from './WorkspaceManager'
import { migrateLegacyDevices } from '../lib/workspaceStore'

vi.mock('./Workspace3DScene', () => ({ default: () => <div>3D scene</div> }))

const state = migrateLegacyDevices([
  { id: 'screen', type: 'monitor', col: 0.5, row: 0.3, role: 'primary_screen' },
  { id: 'camera', type: 'camera', col: 0.5, row: 0.08, role: 'neutral' },
])

describe('WorkspaceManager editor', () => {
  it('offers coupled device presets instead of free dimension and scale controls', async () => {
    render(<WorkspaceManager state={state} onChange={() => ({ ok: true })} onContinue={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(await screen.findByText('Standard proportions')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Device size' })).toHaveValue('monitor_27')
    expect(screen.getByRole('option', { name: '24″' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '34″ ultrawide' })).toBeTruthy()
    expect(screen.queryByText('Object dimensions')).toBeNull()
    expect(screen.queryByText('Overall scale')).toBeNull()
    expect(screen.getByText('Far / near')).toBeTruthy()
  })
})
