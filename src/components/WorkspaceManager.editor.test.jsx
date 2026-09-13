// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspaceManager from './WorkspaceManager'
import { migrateLegacyDevices } from '../lib/workspaceStore'

vi.mock('./Workspace3DScene', () => ({ default: () => <div>3D scene</div> }))

afterEach(cleanup)

const state = migrateLegacyDevices([
  { id: 'screen', type: 'monitor', col: 0.5, row: 0.3, role: 'primary_screen' },
  { id: 'camera', type: 'camera', col: 0.5, row: 0.08, role: 'neutral' },
])

const legacyCustomState = migrateLegacyDevices([
  { id: 'screen', type: 'monitor', col: 0.5, row: 0.3, role: 'primary_screen', dimensions: { width: 1.4, height: 0.8, depth: 1 } },
  { id: 'camera', type: 'camera', col: 0.5, row: 0.08, role: 'neutral' },
])

describe('WorkspaceManager editor', () => {
  it('offers coupled device presets instead of free dimension and scale controls', async () => {
    render(<WorkspaceManager state={state} onChange={() => ({ ok: true })} onContinue={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(await screen.findByText('Standard proportions')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Device size' })).toHaveValue('monitor_27')
    expect(screen.getByRole('option', { name: '24 in (61 cm)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '34 in ultrawide (86 cm)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Custom size' })).toBeTruthy()
    expect(screen.queryByText('Object dimensions')).toBeNull()
    expect(screen.queryByText('Overall scale')).toBeNull()
    expect(screen.getByText('Far / near')).toBeTruthy()
  })

  it('supports a precise custom screen diagonal without exposing free scaling', async () => {
    render(<WorkspaceManager state={state} onChange={() => ({ ok: true })} onContinue={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Device size' }), { target: { value: 'custom' } })

    const diagonal = screen.getByRole('spinbutton', { name: 'Screen diagonal in inches' })
    expect(diagonal).toHaveValue(27)
    fireEvent.change(diagonal, { target: { value: '30.5' } })
    expect(diagonal).toHaveValue(30.5)
    fireEvent.blur(diagonal)
    expect(screen.getByRole('combobox', { name: 'Screen aspect ratio' })).toHaveValue('16:9')
    expect(screen.getByText(/77\.5 cm diagonal/)).toBeTruthy()
    expect(screen.queryByText('Overall scale')).toBeNull()
  })

  it('does not invent an inch measurement for an older custom shape', async () => {
    render(<WorkspaceManager state={legacyCustomState} onChange={() => ({ ok: true })} onContinue={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(await screen.findByText('This older custom shape has no physical measurement yet.')).toBeTruthy()
    expect(screen.queryByRole('spinbutton', { name: 'Screen diagonal in inches' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Enter measured size' }))
    expect(screen.getByRole('spinbutton', { name: 'Screen diagonal in inches' })).toHaveValue(27)
  })

  it('attaches the camera to a display instead of requiring free 3D placement', async () => {
    render(<WorkspaceManager state={state} onChange={() => ({ ok: true })} onContinue={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tracking camera' }))

    const target = await screen.findByRole('combobox', { name: 'Camera mount target' })
    expect(target).toHaveValue('free')
    fireEvent.change(target, { target: { value: 'screen' } })

    expect(screen.getByRole('combobox', { name: 'Camera mount style' })).toHaveValue('integrated')
    expect(screen.getByRole('slider', { name: 'Camera horizontal mount position' })).toHaveValue('0')
    expect(screen.queryByText('Vertical position')).toBeNull()
    expect(screen.getByText('The lens follows this display when it moves or rotates.')).toBeTruthy()
  })
})
