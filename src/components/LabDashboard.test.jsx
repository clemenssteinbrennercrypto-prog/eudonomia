/** @vitest-environment jsdom */
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import LabDashboard from './LabDashboard'
import { FOCUS_METRIC_V1 } from '../lib/focusMetric'
import { NATIVE_CAMERA_MEASUREMENT_V2 } from '../lib/cameraMeasurement'
import { loadFocusLedger, saveSession } from '../lib/storage'
import FocusScorePanel from './analytics/FocusScorePanel'
import { loadFocusScoreSchedule, saveFocusScoreSchedule } from '../lib/focusScoreSchedule'

const SCORE_VIEWS = [['Lab', LabDashboard], ['Analytics', FocusScorePanel]]

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 7, 26, 14, 0, 0))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('LabDashboard metric labels', () => {
  it.each(SCORE_VIEWS)('shows V2 time, attention and consistency and preserves V1 in %s', (_, Component) => {
    vi.setSystemTime(new Date(2026, 8, 16, 10))
    saveFocusScoreSchedule({ version: 1, plans: [{ effectiveFrom: '2026-09-14', workdays: [1, 2, 3, 4, 5] }] })
    const startedAt = new Date(2026, 8, 14, 9).getTime()
    const saved = saveSession({
      startedAt, timestamp: startedAt + 7220_000,
      actualSeconds: 7220, measuredSeconds: 7200, scoreSum: 576000,
      attentionScoringVersion: 2, focusMetricVersion: 1, focusMetricRejection: null,
      sessionEfficiency: 80, deepFocusSeconds: 7200,
    })
    const originalLedger = loadFocusLedger()
    render(React.createElement(Component, { sessions: [saved], ledger: originalLedger }))
    expect(screen.getByRole('button', { name: 'V2 · Current' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /^(Weekly|week)$/ }))
    expect(screen.getByText('63')).toBeInTheDocument()
    expect(screen.getByText(/Consistency: 1\/2 eligible workdays measured \(50%\)/)).toBeInTheDocument()
    expect(screen.getByText('No session today.')).toBeInTheDocument()
    expect(screen.getByText('Average attention')).toBeInTheDocument()
    expect(screen.getByText('Time credit')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'V1 · Previous formula' }))
    expect(screen.getByText('75')).toBeInTheDocument()
    expect(loadFocusLedger()).toEqual(originalLedger)
  })

  it('saves workday changes for tomorrow and reloads them without rewriting today', () => {
    const props = { sessions: [], ledger: loadFocusLedger() }
    const view = render(React.createElement(LabDashboard, props))
    expect(loadFocusScoreSchedule().plans[0]).toEqual({ effectiveFrom: '2026-08-26', workdays: [1, 2, 3, 4, 5] })
    fireEvent.click(screen.getByText('Workdays: Mon, Tue, Wed, Thu, Fri'))
    fireEvent.click(screen.getByLabelText('Tue'))
    fireEvent.click(screen.getByRole('button', { name: 'Save from tomorrow' }))
    expect(loadFocusScoreSchedule().plans).toEqual([
      { effectiveFrom: '2026-08-26', workdays: [1, 2, 3, 4, 5] },
      { effectiveFrom: '2026-08-27', workdays: [1, 3, 4, 5] },
    ])
    view.unmount()
    render(React.createElement(FocusScorePanel, props))
    expect(screen.getByText('From 2026-08-27: Mon, Wed, Thu, Fri.')).toBeInTheDocument()
    expect(screen.getByText('Workdays: Mon, Tue, Wed, Thu, Fri')).toBeInTheDocument()
  })

  it('reports a failed schedule write and keeps the saved plan authoritative', () => {
    render(React.createElement(LabDashboard, { sessions: [], ledger: loadFocusLedger() }))
    const before = loadFocusScoreSchedule()
    fireEvent.click(screen.getByText('Workdays: Mon, Tue, Wed, Thu, Fri'))
    fireEvent.click(screen.getByLabelText('Tue'))
    vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => { throw new Error('Storage full') })
    fireEvent.click(screen.getByRole('button', { name: 'Save from tomorrow' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Storage full')
    expect(loadFocusScoreSchedule()).toEqual(before)
  })

  it.each(SCORE_VIEWS)('keeps the original V1 weekly explanation in %s', (_, Component) => {
    const startedAt = new Date(2026, 7, 25, 9).getTime()
    const saved = saveSession({
      startedAt, timestamp: startedAt + 7220_000,
      actualSeconds: 7220, measuredSeconds: 7200, scoreSum: 540000,
      attentionScoringVersion: 2, focusMetricVersion: 1, focusMetricRejection: null,
      sessionEfficiency: 75, deepFocusSeconds: 7200,
    })
    render(React.createElement(Component, { sessions: [saved], ledger: loadFocusLedger() }))
    fireEvent.click(screen.getByRole('button', { name: 'V1 · Previous formula' }))
    expect(screen.getByText('No session today.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^(Weekly|week)$/ }))
    expect(screen.getByText('72')).toBeInTheDocument()
    expect(screen.getByText('Average of 1 measured day · v1')).toBeInTheDocument()
    expect(screen.getByText('No session today.')).toBeInTheDocument()
    expect(screen.getByText('Only measured days enter this average. Days without sessions do not lower it.')).toBeInTheDocument()
  })

  it.each(SCORE_VIEWS)('refreshes the V2 day after midnight without changed props in %s', (_, Component) => {
    vi.setSystemTime(new Date(2026, 7, 26, 23, 59, 50))
    const startedAt = new Date(2026, 7, 26, 9).getTime()
    const saved = saveSession({
      startedAt, timestamp: startedAt + 7220_000,
      actualSeconds: 7220, measuredSeconds: 7200, scoreSum: 540000,
      attentionScoringVersion: 2, focusMetricVersion: 1, focusMetricRejection: null,
      sessionEfficiency: 75, deepFocusSeconds: 7200,
    })
    render(React.createElement(Component, { sessions: [saved], ledger: loadFocusLedger() }))
    expect(screen.getByText('68')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(30_000))
    expect(screen.queryByText('68')).not.toBeInTheDocument()
    expect(screen.getByText('No session today.')).toBeInTheDocument()
  })

  it('keeps the analytics historical day fixed across the midnight refresh', () => {
    vi.setSystemTime(new Date(2026, 7, 26, 23, 59, 50))
    render(React.createElement(FocusScorePanel, { sessions: [], ledger: loadFocusLedger() }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(screen.getByText('Tuesday, Aug 25, 2026')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(30_000))
    expect(screen.getByText('Tuesday, Aug 25, 2026')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    expect(screen.getByText('Wednesday, Aug 26, 2026')).toBeInTheDocument()
    expect(screen.getByText('No session this day.')).toBeInTheDocument()
  })

  it('navigates one shared day, week, or month across both dashboard signals', () => {
    render(React.createElement(LabDashboard, {
      focusModeEnabled: false,
      sessions: [],
      ledger: loadFocusLedger(),
      onSession() {},
      onProtection() {},
      onAnalytics() {},
    }))

    const rangeGroup = screen.getByRole('group', { name: 'Dashboard range' })
    expect(screen.getAllByRole('button', { name: /^(Daily|Weekly|Monthly)$/ })).toHaveLength(3)
    expect(rangeGroup.querySelector('[aria-pressed="true"]')).toHaveTextContent('Daily')
    expect(screen.getByRole('button', { name: 'Show next day' })).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }))
    expect(screen.getByRole('img', { name: 'Attention field for August 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show next month' })).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Show previous month' }))
    expect(screen.getByRole('img', { name: 'Attention field for July 2026' })).toBeInTheDocument()
    const nextMonth = screen.getByRole('button', { name: 'Show next month' })
    expect(nextMonth).toHaveAttribute('aria-disabled', 'false')
    nextMonth.focus()
    fireEvent.click(nextMonth)
    expect(screen.getByRole('img', { name: 'Attention field for August 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show next month' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Show next month' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Show previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(screen.getByRole('img', { name: 'Attention field for Aug 24–Aug 30, 2026' })).toBeInTheDocument()
    expect(rangeGroup.querySelector('[aria-pressed="true"]')).toHaveTextContent('Weekly')
    expect(screen.getByRole('button', { name: 'Show next week' })).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Show previous week' }))
    expect(screen.getByRole('img', { name: 'Attention field for Aug 17–Aug 23, 2026' })).toBeInTheDocument()
  })

  it('keeps an open historical period fixed when the current date rolls over', () => {
    const startedAt = new Date(2026, 7, 26, 18, 0, 0).getTime()
    const saved = saveSession({
      task: 'Later that day',
      startedAt,
      timestamp: startedAt + 620_000,
      actualSeconds: 620,
      measuredSeconds: 600,
      scoreSum: 46_800,
      focusedSeconds: 480,
      attentionScoringVersion: NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion,
      attentionMeasurementSource: NATIVE_CAMERA_MEASUREMENT_V2.id,
      focusMetricVersion: FOCUS_METRIC_V1.version,
      focusMetricRejection: null,
      sessionEfficiency: 78,
      deepFocusSeconds: 600,
      timeline: [{ second: 60, score: 82 }],
    })
    const props = {
      focusModeEnabled: false,
      sessions: [saved],
      ledger: loadFocusLedger(),
      onSession() {},
      onProtection() {},
      onAnalytics() {},
    }
    const view = render(React.createElement(LabDashboard, props))

    fireEvent.click(screen.getByRole('button', { name: 'Show previous day' }))
    expect(screen.getByRole('img', { name: 'Attention field for Tuesday, Aug 25, 2026' })).toBeInTheDocument()

    vi.setSystemTime(new Date(2026, 7, 27, 1, 0, 0))
    view.rerender(React.createElement(LabDashboard, props))
    expect(screen.getByRole('img', { name: 'Attention field for Tuesday, Aug 25, 2026' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show next day' }))
    expect(screen.getByRole('img', { name: 'Attention field for Wednesday, Aug 26, 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show next day' })).toHaveAttribute('aria-disabled', 'false')
    expect(view.container.querySelectorAll('.attention-field .is-future')).toHaveLength(0)
    expect(view.container.querySelector('.attention-field .is-strong')).toHaveAttribute('title', 'Focus 82')
    expect(view.container.querySelector('.lab-score > strong')).not.toHaveTextContent('—')

    fireEvent.click(screen.getByRole('button', { name: 'Show next day' }))
    expect(screen.getByRole('img', { name: 'Attention field for Thursday, Aug 27, 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show next day' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('loads a real score and attention signal from a previous month', () => {
    const startedAt = new Date(2026, 6, 15, 9, 0, 0).getTime()
    const saved = saveSession({
      task: 'Historical measured work',
      startedAt,
      timestamp: startedAt + 620_000,
      actualSeconds: 620,
      measuredSeconds: 600,
      scoreSum: 46_800,
      focusedSeconds: 480,
      attentionScoringVersion: NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion,
      attentionMeasurementSource: NATIVE_CAMERA_MEASUREMENT_V2.id,
      focusMetricVersion: FOCUS_METRIC_V1.version,
      focusMetricRejection: null,
      sessionEfficiency: 78,
      deepFocusSeconds: 600,
      timeline: [{ second: 60, score: 82 }],
    })
    const view = render(React.createElement(LabDashboard, {
      focusModeEnabled: false,
      sessions: [saved],
      ledger: loadFocusLedger(),
      onSession() {},
      onProtection() {},
      onAnalytics() {},
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show previous month' }))
    expect(screen.getByRole('img', { name: 'Attention field for July 2026' })).toBeInTheDocument()
    expect(view.container.querySelector('.lab-score > strong')).not.toHaveTextContent('—')
    expect(view.container.querySelector('.attention-field .is-strong')).toHaveAttribute('title', 'Focus 82')
    // No workday plan existed in July: do not invent historical consistency.
    expect(screen.getByText('Consistency').parentElement).toHaveTextContent('—')
  })

  it('labels a DST fallback day by local wall-clock quarters', () => {
    const previousTimezone = process.env.TZ
    process.env.TZ = 'Europe/Vienna'
    try {
      vi.setSystemTime(new Date(2026, 9, 25, 12, 0, 0))
      const view = render(React.createElement(LabDashboard, {
        focusModeEnabled: false,
        sessions: [],
        ledger: loadFocusLedger(),
        onSession() {},
        onProtection() {},
        onAnalytics() {},
      }))
      const labels = [...view.container.querySelectorAll('.attention-axis span')].map(tick => tick.textContent)

      expect(labels).toEqual(['00:00', '06:00', '12:00', '18:00', '24:00'])
    } finally {
      if (previousTimezone == null) delete process.env.TZ
      else process.env.TZ = previousTimezone
    }
  })

  it('keeps measured time and efficiency semantically distinct', () => {
    // saveSession still runs so the focus ledger is built by the real code
    // path; sessions and ledger are then handed to the component as props,
    // which is how App supplies them at runtime.
    const saved = saveSession({
      task: 'Measured work',
      startedAt: Date.now() - 620_000,
      actualSeconds: 620,
      measuredSeconds: 600,
      scoreSum: 46_800,
      focusedSeconds: 480,
      attentionScoringVersion: NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion,
      attentionMeasurementSource: NATIVE_CAMERA_MEASUREMENT_V2.id,
      focusMetricVersion: FOCUS_METRIC_V1.version,
      focusMetricRejection: null,
      sessionEfficiency: 78,
      deepFocusSeconds: 600,
      deepFocusMinutes: 10,
      timeline: [
        { second: 30, score: 82 },
        { second: 300, score: 55 },
        { second: 590, score: 22 },
      ],
    })

    const html = renderToString(React.createElement(LabDashboard, {
      focusModeEnabled: false,
      sessions: [saved],
      ledger: loadFocusLedger(),
      onSession() {},
      onProtection() {},
      onAnalytics() {},
    })).replaceAll('<!-- -->', '')

    expect(html).toContain('Measured time')
    expect(html).toContain('78/100 attention')
    expect(html).toContain('Average attention')
    expect(html).toContain('Time credit')
    expect(html).not.toContain('78% efficiency')
    expect(html).toContain('title="Focus 53"')
    expect(html).not.toContain('Complete a measured session to reveal your attention field.')
    expect(html).not.toContain('Measured focus')
    expect(html).not.toContain('78 focus')
  })
})
