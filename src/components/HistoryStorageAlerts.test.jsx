import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import HistoryStorageAlerts from './HistoryStorageAlerts'

describe('history storage alerts', () => {
  it('announces an unverified import without claiming data disappeared', () => {
    const html = renderToStaticMarkup(
      <HistoryStorageAlerts migrationError="database locked" deletionCleanupError={null} screen="lab" />,
    )
    expect(html).toContain('Nothing has been deleted')
    expect(html).toContain('still being read from their original storage')
    expect(html).not.toContain('older browser-storage copy could not be removed')
  })

  it('lets deletion cleanup outrank a stale migration error', () => {
    const html = renderToStaticMarkup(
      <HistoryStorageAlerts
        migrationError="old import failure"
        deletionCleanupError="storage unavailable"
        screen="analytics"
      />,
    )
    expect(html).toContain('history was deleted from the local database')
    expect(html).toContain('older browser-storage copy could not be removed')
    expect(html).not.toContain('Nothing has been deleted')
    expect(html).not.toContain('old import failure')
  })

  it('stays silent over the live session', () => {
    const html = renderToStaticMarkup(
      <HistoryStorageAlerts migrationError="database locked" deletionCleanupError={null} screen="session" />,
    )
    expect(html).toBe('')
  })
})
