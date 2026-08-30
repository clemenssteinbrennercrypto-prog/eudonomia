import { fmtDuration } from '../../lib/sessionAnalysisPresentation'
import { describeFocusMetricRejection } from '../../lib/focusMetric'
import TimelineBar from './TimelineBar'

function activityOutputLine(facts) {
  const bits = []
  bits.push(facts.activity
    ? `Activity tracked for ${Math.round(facts.activity.observedSeconds / 60)} min`
    : 'No activity data')
  bits.push(facts.output ? 'Output folder watched' : 'No output folder watched')
  return bits.join(' · ')
}

/**
 * Always renders, regardless of check-in status — this is what lets the
 * measured record show up before the user has said anything about the
 * outcome. Every number here comes straight from `analysis.measurement`/
 * `analysis.facts`, never from a conclusion (there may not be one yet).
 */
export default function MeasuredFacts({ session, analysis }) {
  const { measurement, facts } = analysis
  const belowThresholdSeconds = measurement.scored
    ? Math.max(0, (measurement.measuredSeconds || 0) - (measurement.focusedSeconds || 0))
    : null

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase', margin: '0 0 6px' }}>
          {session.completed ? 'Session complete' : 'Session ended'}
        </p>
        {measurement.actualSeconds > 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
            {/* Uses the session's own saved timestamp, not the current wall
                clock — this same component renders a session reopened from
                history, potentially long after it happened. */}
            Started at {new Date((session.timestamp || Date.now()) - measurement.actualSeconds * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            {facts.workspace?.name ? ` · ${facts.workspace.name}` : ''}
          </p>
        )}
        {facts.intent.goal && (
          <h1 className="end-headline" style={{ fontSize: 20 }}>{facts.intent.goal}</h1>
        )}
      </div>

      <div className="stats-row" style={{ flexWrap: 'wrap', justifyContent: 'center', rowGap: 32 }}>
        <div className="stat">
          <span className="stat-value">{fmtDuration(measurement.actualSeconds)}</span>
          <span className="stat-label">total duration</span>
        </div>
        <div className="stat-divider" />
        <div className="stat">
          <span
            className="stat-value stat-value-large"
            style={{ fontSize: 72, color: measurement.aboveThresholdPct == null ? 'var(--text-muted)' : measurement.aboveThresholdPct >= 60 ? 'var(--good)' : measurement.aboveThresholdPct >= 40 ? 'var(--warn)' : 'var(--bad)' }}
          >
            {measurement.aboveThresholdPct == null ? '--' : `${measurement.aboveThresholdPct}%`}
          </span>
          <span className="stat-label">{measurement.aboveThresholdPct == null ? 'focus not measured' : 'time above threshold'}</span>
        </div>
        <div className="stat-divider" />
        <div className="stat">
          <span className="stat-value">{facts.drift.alertCount}</span>
          <span className="stat-label">{facts.drift.alertCount === 1 ? 'alert' : 'alerts'}</span>
        </div>
        <div className="stat-divider" />
        <div className="stat">
          <span className="stat-value" style={{ color: belowThresholdSeconds == null ? 'var(--text-muted)' : 'var(--bad)' }}>
            {belowThresholdSeconds == null ? '--' : `${Math.round(belowThresholdSeconds / 60)}m`}
          </span>
          <span className="stat-label">{belowThresholdSeconds == null ? 'distraction not measured' : 'time below threshold'}</span>
        </div>
      </div>

      {session.focusMetricRejection && (() => {
        const notice = describeFocusMetricRejection(session.focusMetricRejection, { measuredSeconds: measurement.measuredSeconds })
        if (!notice) return null
        return (
          <div style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(251,146,60,0.08)',
            border: '1px solid rgba(251,146,60,0.25)',
            borderRadius: 14,
            padding: '12px 16px',
            fontSize: 12.5, lineHeight: 1.5, color: 'var(--warn)',
          }}>
            Not counted toward your daily focus score: {notice}
          </div>
        )
      })()}

      <TimelineBar timeline={session.timeline} />

      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
        {activityOutputLine(facts)}
      </p>
    </div>
  )
}
