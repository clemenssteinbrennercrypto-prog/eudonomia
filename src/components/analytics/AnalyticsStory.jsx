import { useMemo } from 'react'
import { buildAnalyticsStory } from '../../lib/analyticsModel'
import { fmtDuration } from '../../lib/sessionAnalysisPresentation'
import Sessions from './Sessions'

const OUTCOMES = [
  { value: 'yes', label: 'Reached', className: 'is-good' },
  { value: 'partly', label: 'Partly', className: 'is-warn' },
  { value: 'no', label: 'Missed', className: 'is-bad' },
]

function fmtDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function signed(value, suffix = '') {
  if (value == null) return '—'
  return `${value > 0 ? '+' : ''}${value}${suffix}`
}

function OutcomeInbox({ sessions, onRate }) {
  if (sessions.length === 0) return null
  const visible = sessions.slice(0, 3)
  return (
    <section className="analytics-inbox" aria-labelledby="outcome-inbox-heading">
      <div className="analytics-section-heading">
        <div>
          <span className="analytics-kicker">Missing outcomes</span>
          <h2 id="outcome-inbox-heading">How did these sessions go?</h2>
        </div>
        <b>{sessions.length} open</b>
      </div>
      <p className="analytics-copy">Add the result so Analytics can connect measured attention with whether the work actually got done.</p>
      <div className="analytics-inbox-list">
        {visible.map(session => (
          <div className="analytics-inbox-row" key={session.id}>
            <div>
              <strong>{session.goal || session.task || 'Untitled session'}</strong>
              <span>{fmtDate(session.timestamp)} · {fmtDuration(session.actualSeconds)} active</span>
            </div>
            <div className="analytics-outcome-actions" aria-label={`Rate ${session.task || 'session'}`}>
              {OUTCOMES.map(outcome => (
                <button
                  key={outcome.value}
                  type="button"
                  className={outcome.className}
                  onClick={() => onRate(session.id, {
                    goalOutcome: outcome.value,
                    goalAchieved: outcome.value === 'yes' ? true : outcome.value === 'no' ? false : null,
                  })}
                >
                  {outcome.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {sessions.length > visible.length && (
        <p className="analytics-footnote">{sessions.length - visible.length} more unrated sessions remain in Session history.</p>
      )}
    </section>
  )
}

function Experiment({ experiment, onStartExperiment }) {
  const outcome = experiment.evidence?.outcome
  return (
    <section className="analytics-experiment" aria-labelledby="next-experiment-heading">
      <div className="analytics-section-heading">
        <div>
          <span className="analytics-kicker">Next session</span>
          <h2 id="next-experiment-heading">{experiment.title}</h2>
        </div>
        <b>{experiment.source === 'qualified_pattern' ? 'Based on a pattern' : experiment.source === 'latest_session' ? 'Based on your last result' : 'Not enough data yet'}</b>
      </div>
      <p className="analytics-experiment-hypothesis">{experiment.hypothesis}</p>
      {outcome && (
        <p className="analytics-evidence-line">
          Outcome check: {outcome.bestRate}% reached ({outcome.bestN} rated) vs {outcome.worstRate}% ({outcome.worstN} rated).
        </p>
      )}
      {experiment.prefill && Object.keys(experiment.prefill).length > 0 && onStartExperiment && (
        <button type="button" className="analytics-primary-action" onClick={() => onStartExperiment(experiment.prefill)}>
          Use this setup →
        </button>
      )}
    </section>
  )
}

function RecentOverview({ progress, learning }) {
  const current = progress.current
  const remaining = Math.max(0, learning.requiredForComparison - learning.qualified)

  if (current.sessionCount === 0) {
    return (
      <section className="analytics-panel analytics-overview" aria-labelledby="recent-overview-heading">
        <div className="analytics-section-heading">
          <div>
            <span className="analytics-kicker">Overview</span>
            <h2 id="recent-overview-heading">No measured sessions yet</h2>
          </div>
          <b>Nothing inferred</b>
        </div>
        <p className="analytics-copy">Complete a measured session to see recent attention, measured work time, and goal results here.</p>
      </section>
    )
  }

  return (
    <section className="analytics-panel analytics-overview" aria-labelledby="recent-overview-heading">
      <div className="analytics-section-heading">
        <div>
          <span className="analytics-kicker">Overview</span>
          <h2 id="recent-overview-heading">Your latest {current.sessionCount} {current.sessionCount === 1 ? 'session' : 'sessions'}</h2>
        </div>
        <b>Up to 8 recent sessions</b>
      </div>
      <div className="analytics-comparison-grid">
        <div className="analytics-comparison-metric">
          <span>Average attention</span>
          <strong>{current.averageFocus == null ? '—' : `${current.averageFocus}/100`}</strong>
          <small>{progress.comparisonReady ? `${signed(progress.focusDelta, ' pts')} vs previous 8` : 'Measured session average'}</small>
        </div>
        <div className="analytics-comparison-metric">
          <span>Measured time</span>
          <strong>{fmtDuration(current.measuredSeconds)}</strong>
          <small>{progress.comparisonReady ? `Previous 8: ${fmtDuration(progress.previous.measuredSeconds)}` : 'Only time with valid measurements'}</small>
        </div>
        <div className="analytics-comparison-metric">
          <span>Goals reached</span>
          <strong>{current.ratedCount ? `${current.outcomes.yes}/${current.ratedCount}` : '—'}</strong>
          <small>{progress.comparisonReady && progress.outcomeDelta != null ? `${signed(progress.outcomeDelta, ' pts')} vs previous 8` : 'From sessions you rated'}</small>
        </div>
        <div className="analytics-comparison-metric">
          <span>Rated</span>
          <strong>{current.ratedCount}/{current.sessionCount}</strong>
          <small>{current.sessionCount - current.ratedCount === 0 ? 'All results added' : `${current.sessionCount - current.ratedCount} still open`}</small>
        </div>
      </div>
      {progress.comparisonReady ? (
        <p className="analytics-overview-note">Compared with the previous 8 sessions measured the same way. Open Details to inspect the underlying groups.</p>
      ) : (
        <>
          <div className="analytics-progress-track" aria-label={`${learning.qualified} of ${learning.requiredForComparison} sessions needed for a trend comparison`}>
            <span style={{ width: `${Math.min(100, (learning.qualified / learning.requiredForComparison) * 100)}%` }} />
          </div>
          <p className="analytics-overview-note">
            These values are useful now. After {remaining} more {remaining === 1 ? 'session' : 'sessions'} measured the same way, Analytics can compare this block with the previous one.
          </p>
        </>
      )}
    </section>
  )
}

export default function AnalyticsStory({
  sessions,
  focusLedger,
  selectedSessionId,
  onSelectSession,
  onDeleteSession,
  onClearAll,
  onUpdateSession,
  onStartExperiment,
}) {
  const story = useMemo(() => buildAnalyticsStory(sessions), [sessions])

  return (
    <div className="analytics-story">
      <RecentOverview progress={story.progress} learning={story.learning} />
      <OutcomeInbox sessions={story.unratedSessions} onRate={onUpdateSession} />
      <Experiment experiment={story.experiment} onStartExperiment={onStartExperiment} />
      <section className="analytics-history" aria-labelledby="session-history-heading">
        <div className="analytics-section-heading">
          <div>
            <span className="analytics-kicker">History</span>
            <h2 id="session-history-heading">Session history</h2>
          </div>
          <b>{sessions.length} total</b>
        </div>
        <Sessions
          compact
          sessions={sessions}
          focusLedger={focusLedger}
          selectedSessionId={selectedSessionId}
          onSelectSession={onSelectSession}
          onDeleteSession={onDeleteSession}
          onClearAll={onClearAll}
          onUpdateSession={onUpdateSession}
        />
      </section>
    </div>
  )
}
