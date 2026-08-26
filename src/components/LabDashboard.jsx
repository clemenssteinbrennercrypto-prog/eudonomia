import { useEffect, useMemo, useState } from 'react'
import { loadFocusAppsConfig, loadFocusLedger, loadSessions } from '../lib/storage'
import { buildDashboardData } from '../lib/dashboardData'
import { fetchCompanionDebug } from '../lib/nativeCompanion'

const SCORE_RANGES = [['day', 'Daily'], ['week', 'Weekly']]
const FIELD_RANGES = [['day', 'Today'], ['week', 'Week'], ['month', 'Month']]

function SegmentedControl({ items, value, onChange, label }) {
  return (
    <div className="lab-segments" aria-label={label}>
      {items.map(([id, text]) => (
        <button key={id} type="button" className={value === id ? 'is-active' : ''} onClick={() => onChange(id)}>{text}</button>
      ))}
    </div>
  )
}

function Metric({ label, value, suffix }) {
  return (
    <div className="lab-metric">
      <span>{label}</span>
      <strong>{value ?? '—'}{value != null && suffix ? <small>{suffix}</small> : null}</strong>
    </div>
  )
}

function AttentionField({ bins }) {
  return (
    <div className="attention-field" role="img" aria-label="Attention field derived from measured focus samples">
      {bins.map(bin => (
        <i
          key={bin.index}
          className={`attention-bin is-${bin.state}`}
          style={{ '--attention-height': bin.score == null ? '18%' : `${Math.max(18, bin.score)}%` }}
          title={bin.score == null ? bin.state : `Focus ${bin.score}`}
        />
      ))}
    </div>
  )
}

export default function LabDashboard({ focusModeEnabled, onSession, onProtection, onAnalytics }) {
  const [scoreRange, setScoreRange] = useState('day')
  const [fieldRange, setFieldRange] = useState('day')
  const [nativeStatus, setNativeStatus] = useState({ checked: false, connected: false, helperInstalled: false })
  const source = useMemo(() => ({
    ledger: loadFocusLedger(),
    sessions: loadSessions(),
    focusConfig: loadFocusAppsConfig(),
  }), [])
  const data = useMemo(() => buildDashboardData({
    ...source,
    focusModeEnabled,
    scoreRange,
    fieldRange,
    nativeStatus,
  }), [source, focusModeEnabled, scoreRange, fieldRange, nativeStatus])
  const { period } = data
  const measuredMinutes = Math.round(period.measuredSeconds / 60)
  const hasAttentionSignal = data.attention.some(bin => !['inactive', 'no-signal', 'future'].includes(bin.state))

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const debug = await fetchCompanionDebug()
      if (!cancelled) setNativeStatus({
        checked: true,
        connected: Boolean(debug),
        helperInstalled: debug?.helperInstalled === true,
      })
    }
    check()
    const interval = window.setInterval(check, 10000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [])

  return (
    <main className="lab-dashboard">
      <section className="lab-hero" aria-labelledby="lab-title">
        <div className="lab-score-block">
          <div className="lab-section-head">
            <div>
              <span className="lab-eyebrow">Command / Lab</span>
              <h1 id="lab-title">Focus Score</h1>
            </div>
            <SegmentedControl items={SCORE_RANGES} value={scoreRange} onChange={setScoreRange} label="Focus score range" />
          </div>
          <div className={`lab-score${period.score == null ? ' is-empty' : ''}`}>
            <strong>{period.score ?? '—'}</strong>
            <span>{period.score == null ? 'Not measured' : `${scoreRange === 'day' ? 'Today' : 'This week'} · v1`}</span>
          </div>
        </div>

        <div className="lab-metric-rail">
          <Metric label="Measured time" value={period.score == null ? null : measuredMinutes} suffix="min" />
          <Metric label="Deep focus" value={period.score == null ? null : Math.round(period.deepFocusMinutes)} suffix="min" />
          <Metric label="Efficiency" value={period.efficiency} suffix="%" />
          <Metric label="Consistency" value={period.streak} suffix="day streak" />
        </div>

        <button className="lab-session-orb" type="button" onClick={onSession} aria-label="Open session setup">
          <span className="lab-session-orb-ring" aria-hidden="true" />
          <span className="lab-session-orb-copy"><small>Session</small><b>Start</b><i aria-hidden="true">↗</i></span>
        </button>
      </section>

      <section className="lab-attention-section">
        <div className="lab-section-head">
          <div>
            <span className="lab-eyebrow">Measured signal</span>
            <h2>Attention Field</h2>
          </div>
          <SegmentedControl items={FIELD_RANGES} value={fieldRange} onChange={setFieldRange} label="Attention field range" />
        </div>
        <AttentionField bins={data.attention} />
        {!hasAttentionSignal && <p className="attention-empty">Complete a measured session to reveal your attention field.</p>}
        <div className="attention-legend">
          <span className="is-strong">Strong</span><span className="is-focused">Focused</span><span className="is-drift">Drift</span><span className="is-no-signal">No signal</span><span className="is-inactive">Inactive</span><span className="is-future">Future</span>
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
                  <span>{session.durationMinutes} min</span>
                  <span>{session.efficiency == null ? 'Not measured' : `${Math.round(session.efficiency)}% efficiency`}</span>
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
