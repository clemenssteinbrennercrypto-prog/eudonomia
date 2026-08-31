import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dashboardSource = readFileSync(new URL('./LabDashboard.jsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')

// A completed session must never leave stale numbers on the Lab screen. That
// responsibility used to sit in LabDashboard, which re-read storage whenever
// `sessionRevision` changed. Loading is async now and lives in App, which
// already owned that revision counter — so the guarantee is asserted there,
// and LabDashboard is checked to be a pure render of what it is handed.
describe('lab data stays fresh after a session', () => {
  it('App re-reads session history whenever the revision changes', () => {
    expect(appSource).toContain('sessionRepository.loadAll()')
    expect(appSource).toContain('}, [sessionRevision])')
  })

  it('does not turn a repository failure into an empty-history screen', () => {
    expect(appSource).toContain('setHistoryLoadError(String(error?.message || error))')
    expect(appSource).toContain('Retry history')
  })

  it('App bumps the revision after a session is persisted', () => {
    expect(appSource).toContain('setSessionRevision(value => value + 1)')
  })

  it('App hands the loaded history down to the dashboard', () => {
    expect(appSource).toContain('sessions={history.sessions}')
    expect(appSource).toContain('ledger={history.ledger}')
  })

  it('LabDashboard renders the props it is given rather than reading storage itself', () => {
    expect(dashboardSource).toContain('sessions = [], ledger = null')
    expect(dashboardSource).not.toContain('loadSessions')
    expect(dashboardSource).not.toContain('loadFocusLedger')
  })
})
