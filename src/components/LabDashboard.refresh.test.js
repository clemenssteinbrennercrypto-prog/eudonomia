import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./LabDashboard.jsx', import.meta.url), 'utf8')

describe('LabDashboard storage refresh', () => {
  it('reloads storage when a session completes', () => {
    expect(source).toContain('sessionRevision = 0')
    expect(source).toContain('}), [sessionRevision])')
  })
})
