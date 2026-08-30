import { useMemo } from 'react'
import { aggregateFocusMeasurements, outcomeDistribution, sessionFocusMeasurement } from '../../lib/historyTrend'
import { calibrate } from '../../lib/calibration'
import { fmtDuration } from '../../lib/sessionAnalysisPresentation'
import FocusScorePanel from './FocusScorePanel'
import TrendChart from './TrendChart'

const OVERVIEW_RANGE_DAYS = 30

const OUTCOME_ITEMS = [
  { key: 'yes', label: 'Yes', color: 'var(--good)' },
  { key: 'partly', label: 'Partly', color: 'var(--warn)' },
  { key: 'no', label: 'No', color: 'var(--bad)' },
]

function sessionsInLastNDays(sessions, days, now = Date.now()) {
  const cutoff = now - days * 24 * 60 * 60 * 1000
  return sessions.filter(s => Number.isFinite(s?.timestamp) && s.timestamp >= cutoff)
}

function StatTile({ label, value, color }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 14px', textAlign: 'center' }}>
      <p style={{ fontSize: 26, fontWeight: 300, letterSpacing: '-0.02em', color: color || 'var(--text)', margin: '0 0 4px' }}>{value}</p>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, margin: 0 }}>{label}</p>
    </div>
  )
}

function OutcomeDistribution({ outcomes }) {
  const answered = OUTCOME_ITEMS.reduce((sum, item) => sum + outcomes[item.key], 0)
  const total = answered + outcomes.unrated
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px' }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 12px' }}>
        Outcome distribution
      </p>
      {total === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No sessions in this range.</p>
      ) : (
        <>
          <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: 'rgba(122,152,255,0.06)' }}>
            {OUTCOME_ITEMS.map(item => outcomes[item.key] > 0 && (
              <div key={item.key} title={`${item.label}: ${outcomes[item.key]}`} style={{ flex: outcomes[item.key], minWidth: 4, background: item.color }} />
            ))}
            {outcomes.unrated > 0 && (
              <div title={`Unrated: ${outcomes.unrated}`} style={{ flex: outcomes.unrated, minWidth: 4, background: 'var(--line-strong)' }} />
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: 10 }}>
            {OUTCOME_ITEMS.map(item => (
              <span key={item.key} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                <span style={{ color: item.color, fontWeight: 800 }}>{item.label}</span>: {outcomes[item.key]}
              </span>
            ))}
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <span style={{ color: 'var(--line-strong)', fontWeight: 800 }}>Unrated</span>: {outcomes.unrated}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Defaults to the last 30 days and presents a balanced summary rather than one
 * hero metric — session count, measured focused time, outcome distribution,
 * the versioned daily Focus Score, data coverage, a trend chart, and either
 * the strongest qualified pattern or honest progress toward enough evidence.
 */
export default function Overview({ sessions, focusLedger }) {
  const recent = useMemo(() => sessionsInLastNDays(sessions, OVERVIEW_RANGE_DAYS), [sessions])
  const aggregate = useMemo(() => aggregateFocusMeasurements(recent), [recent])
  const outcomes = useMemo(() => outcomeDistribution(recent), [recent])
  const coverage = useMemo(() => ({
    measured: recent.filter(s => sessionFocusMeasurement(s) != null).length,
    total: recent.length,
  }), [recent])
  const calibration = useMemo(() => calibrate(sessions), [sessions])
  const strongest = calibration.ready ? calibration.insights[0] : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Last 30 days</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <StatTile label="Sessions" value={recent.length} />
        <StatTile label="Measured focused time" value={fmtDuration(aggregate.focusedSeconds)} />
        <StatTile label="Data coverage" value={coverage.total ? `${coverage.measured}/${coverage.total} measured` : '--'} />
      </div>

      <OutcomeDistribution outcomes={outcomes} />

      <FocusScorePanel ledger={focusLedger} sessions={sessions} />

      <TrendChart sessions={sessions} />

      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 20 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 10px' }}>
          Strongest pattern
        </p>
        {strongest ? (
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
            {strongest.text} <span style={{ color: 'var(--text-muted)' }}>({strongest.n} sessions)</span>
          </p>
        ) : calibration.ready ? (
          <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            No pattern stands out yet — your sessions look consistent across the conditions tracked so far.
          </p>
        ) : (
          <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            {calibration.needMore} more measured {calibration.needMore === 1 ? 'session' : 'sessions'} before a pattern can be named honestly. See Patterns for the full breakdown.
          </p>
        )}
      </div>
    </div>
  )
}
