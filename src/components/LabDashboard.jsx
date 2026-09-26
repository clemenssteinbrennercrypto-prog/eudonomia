import { useMemo, useState } from 'react'
import { loadFocusAppsConfig } from '../lib/storage'
import { emptyFocusLedger, getFocusPeriodWindow } from '../lib/focusMetric'
import { buildDashboardData } from '../lib/dashboardData'
import { useCompanionStatus } from '../lib/useCompanionStatus'
import { useCurrentTime } from '../lib/useCurrentTime'
import FocusScoreExplanation, { focusScoreLabel } from './FocusScoreExplanation'
import { fmtDuration } from '../lib/sessionAnalysisPresentation'
import FocusScoreControls from './FocusScoreControls'
import { useFocusScoreSchedule } from '../lib/useFocusScoreSchedule'

const PERIOD_RANGES = [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']]

function SegmentedControl({ items, value, onChange, label }) {
  return (
    <div className="lab-segments" role="group" aria-label={label}>
      {items.map(([id, text]) => (
        <button key={id} type="button" aria-pressed={value === id} className={value === id ? 'is-active' : ''} onClick={() => onChange(id)}>{text}</button>
      ))}
    </div>
  )
}

function Metric({ label, value, suffix, detail }) {
  return (
    <div className="lab-metric">
      <span>{label}</span>
      <strong>{value ?? '—'}{value != null && suffix ? <small>{suffix}</small> : null}</strong>
      {detail ? <small className="lab-metric-detail">{detail}</small> : null}
    </div>
  )
}

function AttentionField({ bins, range, title }) {
  const start = bins[0]?.timestamp
  const interval = bins.length > 1 ? bins[1].timestamp - start : 0
  const end = bins.at(-1)?.timestamp + interval
  const tickCount = range === 'day' ? 5 : range === 'week' ? 8 : 6
  const formatTick = (timestamp, index) => {
    const date = new Date(timestamp)
    if (range === 'day') {
      if (index === tickCount - 1) return '24:00'
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    }
    if (range === 'week') {
      return date.toLocaleDateString([], { weekday: 'short', day: '2-digit' })
    }
    return date.toLocaleDateString([], { day: '2-digit', month: 'short' })
  }
  const ticks = Number.isFinite(start) && Number.isFinite(end)
    ? range === 'day'
      ? [0, 6, 12, 18, 24].map(hour => {
        const tick = new Date(start)
        tick.setHours(hour, 0, 0, 0)
        const timestamp = tick.getTime()
        return { position: (timestamp - start) / (end - start), timestamp }
      })
      : Array.from({ length: tickCount }, (_, index) => ({
        position: index / (tickCount - 1),
        timestamp: start + ((end - start) * index) / (tickCount - 1),
      }))
    : []

  return (
    <div className="attention-timeline">
      <div className="attention-field" role="img" aria-label={`Attention field for ${title}`}>
        {bins.map(bin => (
          <i
            key={bin.index}
            className={`attention-bin is-${bin.state}`}
            style={{ '--attention-height': bin.score == null ? '18%' : `${Math.max(18, bin.score)}%` }}
            title={bin.score == null ? bin.state : `Focus ${bin.score}`}
          />
        ))}
      </div>
      <div className="attention-axis" aria-hidden="true">
        {ticks.map((tick, index) => (
          <span key={tick.timestamp} style={{ left: `${tick.position * 100}%` }}>
            <i />{formatTick(tick.timestamp, index)}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function LabDashboard({ focusModeEnabled, sessions = [], ledger = null, onSession, onProtection, onAnalytics }) {
  const [periodSelection, setPeriodSelection] = useState({ range: 'day', periodStart: null })
  const scheduleState = useFocusScoreSchedule()
  const nativeStatus = useCompanionStatus()
  // Sessions and the ledger arrive as props — App owns loading them and
  // re-reads after every completed session, so this stays a pure render of
  // whatever it is handed. focusConfig is a local settings key, not session
  // history, so it is still read directly.
  const source = useMemo(() => ({
    ledger: ledger || emptyFocusLedger(),
    sessions,
    focusConfig: loadFocusAppsConfig(),
  }), [ledger, sessions])
  const dashboardNow = useCurrentTime()
  const data = useMemo(() => buildDashboardData({
    ...source,
    focusModeEnabled,
    range: periodSelection.range,
    periodStart: periodSelection.periodStart,
    now: dashboardNow,
    nativeStatus,
    metricVersion: 1,
    schedule: scheduleState.schedule,
  }), [source, focusModeEnabled, periodSelection, dashboardNow, nativeStatus, scheduleState.schedule])
  const { period } = data
  // V1 already stores one versioned, phase-weighted time contribution for
  // every qualifying historical session. The newer exact Flow accumulator is
  // forward-only; summing its known subset made a week containing old sessions
  // look like it contained only today's couple of minutes. Period surfaces use
  // the complete V1 time ruler, while session details may still show exact
  // forward-recorded Flow time.
  const displayedFocusSeconds = period.score == null
    ? null
    : Math.round(period.deepFocusMinutes * 60)
  const focusTimeDetail = period.range === 'day'
    ? 'Phase-weighted focus time'
    : `Across ${period.activeDays} measured ${period.activeDays === 1 ? 'day' : 'days'} · phase-weighted`
  const hasAttentionSignal = data.attention.some(bin => !['inactive', 'no-signal', 'paused', 'future'].includes(bin.state))
  const selectRange = range => setPeriodSelection({ range, periodStart: null })
  const movePeriod = delta => setPeriodSelection(current => {
    const realNow = Date.now()
    const displayedWindow = getFocusPeriodWindow(
      current.range,
      0,
      new Date(current.periodStart ?? realNow)
    )
    if (delta < 0) {
      const previous = getFocusPeriodWindow(current.range, -1, displayedWindow.start)
      return { ...current, periodStart: previous.start.getTime() }
    }

    const liveWindow = getFocusPeriodWindow(current.range, 0, new Date(realNow))
    const nextStart = displayedWindow.endExclusive.getTime()
    if (nextStart >= liveWindow.start.getTime()) {
      return { ...current, periodStart: null }
    }
    return { ...current, periodStart: nextStart }
  })

  return (
    <main className="lab-dashboard">
      <section className="lab-period-toolbar" aria-label="Dashboard time period">
        <SegmentedControl items={PERIOD_RANGES} value={periodSelection.range} onChange={selectRange} label="Dashboard range" />
        <div className="lab-period-navigation">
          <button type="button" onClick={() => movePeriod(-1)} aria-label={`Show previous ${periodSelection.range}`}>←</button>
          <strong aria-live="polite">{period.title}</strong>
          <button type="button" onClick={() => period.canGoForward && movePeriod(1)} aria-disabled={!period.canGoForward} aria-label={`Show next ${periodSelection.range}`}>→</button>
        </div>
      </section>

      <section className="lab-hero" aria-labelledby="lab-title">
        <div className="lab-score-block">
          <div className="lab-section-head">
            <div>
              <span className="lab-eyebrow">Command / Lab</span>
              <h1 id="lab-title">Focus Score</h1>
            </div>
          </div>
          <div className={`lab-score${period.score == null ? ' is-empty' : ''}`}>
            <strong>{period.score ?? '—'}</strong>
            <span>{focusScoreLabel(period)}</span>
          </div>
        </div>

        <div className="lab-metric-rail">
          <Metric
            label="Focus time"
            value={displayedFocusSeconds == null ? null : fmtDuration(displayedFocusSeconds)}
            detail={focusTimeDetail}
          />
          <Metric label="Measured work" value={period.measuredSeconds > 0 ? fmtDuration(period.measuredSeconds) : null} />
          <Metric label="Average attention" value={period.efficiency} suffix="/100" />
          <Metric label="Measured days" value={`${period.activeDays}/${period.elapsedDays}`} suffix="days" />
        </div>

        <button className="lab-session-orb" type="button" onClick={onSession} aria-label="Open session setup">
          <span className="lab-session-orb-ring" aria-hidden="true" />
          <span className="lab-session-orb-copy"><small>Session</small><b>Start</b><i aria-hidden="true">↗</i></span>
        </button>
      </section>

      <FocusScoreExplanation period={period} />
      <p className="focus-score-explanation">Your workday plan stays available as context, but it does not alter Focus Score.</p>
      <FocusScoreControls metricVersion={2} onVersionChange={() => {}} scheduleState={scheduleState} now={dashboardNow} showMetricVersions={false} />

      <section className="lab-attention-section">
        <div className="lab-section-head">
          <div>
            <span className="lab-eyebrow">Measured signal</span>
            <h2>Attention Field</h2>
          </div>
          <span className="lab-period-scope">{period.title}</span>
        </div>
        <AttentionField bins={data.attention} range={periodSelection.range} title={period.title} />
        {!hasAttentionSignal && <p className="attention-empty">Complete a measured session to reveal your attention field.</p>}
        <div className="attention-legend">
          <span className="is-strong">Strong</span><span className="is-focused">Focused</span><span className="is-drift">Drift</span><span className="is-paused">Break</span><span className="is-no-signal">No signal</span><span className="is-inactive">Inactive</span><span className="is-future">Future</span>
        </div>
      </section>

      <section className="lab-lower-grid">
        <button className={`lab-lock lab-lock-${data.protection.state}`} type="button" onClick={onProtection}>
          <span className="lab-lock-icon" aria-hidden="true"><i /></span>
          <span><small>Locked In</small><strong>{data.protection.label}</strong><em>{data.protection.detail}</em></span>
          <b aria-hidden="true">Configure →</b>
        </button>

        <div className="lab-recent">
          <div className="lab-section-head">
            <div><span className="lab-eyebrow">Last runs</span><h2>Recent Sessions</h2></div>
            <button type="button" className="lab-text-action" onClick={onAnalytics}>View all →</button>
          </div>
          {data.recentSessions.length === 0 ? (
            <p className="lab-empty-copy">Your completed sessions will appear here.</p>
          ) : (
            <div className="lab-session-list">
              {data.recentSessions.map(session => (
                <div className="lab-session-row" key={session.id}>
                  <strong>{session.task}</strong>
                  <span>{fmtDuration(session.durationSeconds)}</span>
                  <span>{session.efficiency == null ? 'Not measured' : `${Math.round(session.efficiency)}/100 attention`}</span>
                  <em className={`is-${session.outcome.toLowerCase()}`}>{session.outcome}</em>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
