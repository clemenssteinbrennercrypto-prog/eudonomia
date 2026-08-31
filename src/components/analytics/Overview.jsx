import { useMemo } from 'react'
import {
  aggregateAverageFocus,
  aggregateFocusMeasurements,
  outcomeDistribution,
  sessionFocusMeasurement,
} from '../../lib/historyTrend'
import { calibrate } from '../../lib/calibration'
import { fmtDuration } from '../../lib/sessionAnalysisPresentation'
import FocusScorePanel from './FocusScorePanel'
import TrendChart from './TrendChart'

const OVERVIEW_RANGE_DAYS = 30

const OUTCOME_ITEMS = [
  { key: 'yes', label: 'YES', color: 'var(--good)' },
  { key: 'partly', label: 'PARTLY', color: 'var(--warn)' },
  { key: 'no', label: 'NO', color: 'var(--bad)' },
]

function sessionsInLastNDays(sessions, days, now = Date.now()) {
  const cutoff = now - days * 24 * 60 * 60 * 1000
  return sessions.filter(s => Number.isFinite(s?.timestamp) && s.timestamp >= cutoff)
}

function focusTone(pct) {
  if (pct == null) return 'is-idle'
  if (pct >= 70) return 'is-good'
  if (pct >= 40) return 'is-warn'
  return 'is-bad'
}

/** One readout in the instrument grid. `sub` carries the denominator or unit
 *  that stops a bare number from being ambiguous. */
function Readout({ label, value, sub, tone = '' }) {
  return (
    <div className={`term-cell ${tone}`.trim()}>
      <b>{value}</b>
      <small>{label}</small>
      {sub && <i>{sub}</i>}
    </div>
  )
}

function OutcomeDistribution({ outcomes }) {
  const answered = OUTCOME_ITEMS.reduce((sum, item) => sum + outcomes[item.key], 0)
  const total = answered + outcomes.unrated
  const share = (n) => (total > 0 ? Math.round((n / total) * 100) : 0)

  return (
    <section className="term-panel">
      <div className="term-rule">
        <h2>Outcome distribution</h2>
        <span>{total} rated · {outcomes.unrated} open</span>
      </div>
      {total === 0 ? (
        <p className="term-note">No sessions in this range.</p>
      ) : (
        <>
          <div className="term-bar">
            {OUTCOME_ITEMS.map(item => outcomes[item.key] > 0 && (
              <div
                key={item.key}
                title={`${item.label}: ${outcomes[item.key]}`}
                style={{ flex: outcomes[item.key], background: item.color }}
              />
            ))}
            {outcomes.unrated > 0 && (
              <div title={`Unrated: ${outcomes.unrated}`} style={{ flex: outcomes.unrated, background: 'var(--line-strong)' }} />
            )}
          </div>
          <div className="term-legend">
            {OUTCOME_ITEMS.map(item => (
              <span key={item.key}>
                <b style={{ color: item.color }}>{item.label}</b> {String(outcomes[item.key]).padStart(2, '0')} · {String(share(outcomes[item.key])).padStart(2, '0')}%
              </span>
            ))}
            <span>
              <b style={{ color: 'var(--line-strong)' }}>UNRATED</b> {String(outcomes.unrated).padStart(2, '0')} · {String(share(outcomes.unrated)).padStart(2, '0')}%
            </span>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * Defaults to the last 30 days and presents a balanced summary rather than one
 * hero metric — session count, measured focused time, average focus, outcome
 * distribution, the versioned daily Focus Score, data coverage, a trend chart,
 * and either the strongest qualified pattern or honest progress toward enough
 * evidence.
 *
 * Laid out as an instrument panel: hairline grid, monospaced figures, labels
 * subordinate to numbers. Denser than a card layout and steadier to read, since
 * every figure keeps its column as it changes.
 */
export default function Overview({ sessions, focusLedger }) {
  const recent = useMemo(() => sessionsInLastNDays(sessions, OVERVIEW_RANGE_DAYS), [sessions])
  const aggregate = useMemo(() => aggregateFocusMeasurements(recent), [recent])
  const averageFocus = useMemo(() => aggregateAverageFocus(recent), [recent])
  const outcomes = useMemo(() => outcomeDistribution(recent), [recent])
  const coverage = useMemo(() => ({
    measured: recent.filter(s => sessionFocusMeasurement(s) != null).length,
    total: recent.length,
  }), [recent])
  const calibration = useMemo(() => calibrate(sessions), [sessions])
  const strongest = calibration.ready ? calibration.insights[0] : null
  const coveragePct = coverage.total > 0 ? Math.round((coverage.measured / coverage.total) * 100) : null

  return (
    <div className="term" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section>
        <div className="term-rule">
          <h2>Last 30 days</h2>
          <span>{OVERVIEW_RANGE_DAYS}D window</span>
        </div>
        <div className="term-grid">
          <Readout
            label="Sessions"
            value={String(recent.length).padStart(2, '0')}
          />
          <Readout
            label="Average focus"
            value={averageFocus == null ? '—' : `${averageFocus}%`}
            sub={averageFocus == null ? 'nothing measured yet' : 'mean over measured time'}
            tone={focusTone(averageFocus)}
          />
          <Readout
            label="Measured focused time"
            value={fmtDuration(aggregate.focusedSeconds)}
            sub={`of ${fmtDuration(aggregate.measuredSeconds)} measured`}
          />
          <Readout
            label="Data coverage"
            value={coveragePct == null ? '—' : `${coveragePct}%`}
            sub={coverage.total > 0 ? `${coverage.measured} of ${coverage.total} sessions` : 'no sessions in range'}
            tone={coveragePct == null ? 'is-idle' : ''}
          />
        </div>
      </section>

      <OutcomeDistribution outcomes={outcomes} />

      <FocusScorePanel ledger={focusLedger} sessions={sessions} />

      <TrendChart sessions={sessions} />

      <section className="term-panel">
        <div className="term-rule">
          <h2>Strongest pattern</h2>
          <span>{calibration.ready ? `${calibration.sessionsAnalysed} qualified` : `${calibration.sessionsAnalysed} of 8`}</span>
        </div>
        {strongest ? (
          <p className="term-note">
            {strongest.text} <em>({strongest.n} sessions)</em>
          </p>
        ) : calibration.ready ? (
          <p className="term-note">
            No pattern stands out yet — your sessions look consistent across the conditions tracked so far.
          </p>
        ) : (
          <p className="term-note">
            {calibration.needMore} more measured {calibration.needMore === 1 ? 'session' : 'sessions'} before a
            pattern can be named honestly. <em>See Patterns for the full breakdown.</em>
          </p>
        )}
      </section>
    </div>
  )
}
