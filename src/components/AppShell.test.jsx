import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import AppShell from './AppShell'

describe('app shell legal entry point', () => {
  it('renders an in-app Legal control when provided', () => {
    const output = renderToString(React.createElement(AppShell, {
      active: 'lab',
      onNavigate: vi.fn(),
      onLegal: vi.fn(),
      utility: null,
      children: React.createElement('main', null, 'content'),
    }))
    expect(output).toContain('>Legal</button>')
  })
})
