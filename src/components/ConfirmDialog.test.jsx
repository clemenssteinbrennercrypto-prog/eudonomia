/** @vitest-environment jsdom */
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConfirmDialog from './ConfirmDialog'

afterEach(cleanup)

describe('ConfirmDialog', () => {
  it('exposes the title and description as the dialog accessible name and description', () => {
    render(
      <ConfirmDialog
        title="Delete this session?"
        description="This cannot be undone."
        confirmLabel="Delete session"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Delete this session?' })
    expect(dialog).toHaveAttribute('aria-describedby')
    expect(within(dialog).getByText('This cannot be undone.')).toBeInTheDocument()
  })

  it('focuses Cancel initially, cancels on Escape, and returns focus to the opener', () => {
    const onCancel = vi.fn()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()

    function Harness() {
      const [open, setOpen] = React.useState(true)
      return open ? <ConfirmDialog title="Delete?" description="Gone forever." confirmLabel="Delete" onConfirm={() => {}} onCancel={() => { onCancel(); setOpen(false) }} /> : null
    }
    render(<Harness />)

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('does not invoke the destructive action before explicit confirmation and disables controls while pending', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog title="Delete?" description="Gone forever." confirmLabel="Delete" busy onConfirm={onConfirm} onCancel={() => {}} />,
    )

    expect(onConfirm).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Working…' })).toBeDisabled()
  })
})
