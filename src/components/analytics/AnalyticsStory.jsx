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

function signedDuration(seconds) {
  if (seconds == null) return '—'
  return `${seconds > 0 ? '+' : seconds < 0 ? '−' : ''}${fmtDuration(Math.abs(seconds))}`
}

function OutcomeInbox({ sessions, onRate }) {
  if (sessions.length === 0) return null
  const visible = sessions.slice(0, 3)
  return (
    <section className="analytics-inbox" aria-labelledby="outcome-inbox-heading">
      <div className="analytics-section-heading">
        <div>
          <span className="analytics-kicker">Outcome inbox</span>
          <h2 id="outcome-inbox-heading">Close the evidence gap</h2>
        </div>
        <b>{sessions.length} open</b>
      </div>
      <p className="analytics-copy">Your outcome is the ground truth. Focus explains it; it does not replace it.</p>
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
          <span className="analytics-kicker">Next experiment</span>
          <h2 id="next-experiment-heading">{experiment.title}</h2>
        </div>
        <b>{experiment.source === 'qualified_pattern' ? 'Pattern' : experiment.source === 'latest_session' ? 'Latest session' : 'Collecting'}</b>
      </div>
      <p className="analytics-experiment-hypothesis">{experiment.hypothesis}</p>
      {outcome && (
        <p className="analytics-evidence-line">
          Outcome check: {outcome.bestRate}% reached ({outcome.bestN} rated) vs {outcome.worstRate}% ({outcome.worstN} rated).
        </p>
      )}
      {experiment.prefill && Object.keys(experiment.prefill).length > 0 && onStartExperiment && (
        <button type="button" className="analytics-primary-action" onClick={() => onStartExperiment(experiment.prefill)}>
          Set up this experiment →
        </button>
      )}
    </section>
  )
}

function Progress({ progress, learning }) {
  if (!progress.comparisonReady) {
    const remaining = Math.max(0, learning.requiredForComparison - learning.qualified)
    return (
      <section className="analytics-panel" aria-labelledby="progress-heading">
        <div className="analytics-section-heading">
          <div>
            <span className="analytics-kicker">Progress</span>
            <h2 id="progress-heading">Two comparable blocks</h2>
          </div>
          <b>{learning.qualified}/{learning.requiredForComparison}</b>
        </div>
        <div className="analytics-progress-track" aria-label={`${learning.qualified} of ${learning.requiredForComparison} comparable sessions`}>
          <span style={{ width: `${Math.min(100, (learning.qualified / learning.requiredForComparison) * 100)}%` }} />
        </div>
        <p className="analytics-copy">
          {remaining > 0
            ? `${remaining} more compatible measured ${remaining === 1 ? 'session' : 'sessions'} before the latest 8 can be compared with the previous 8.`
            : 'Waiting for two complete comparable blocks.'}
          {learning.generation ? ` Current ruler: V${learning.generation}.` : ' No explicit compatible ruler is available yet.'}
        </p>
      </section>
    )
  }

  return (
    <section className="analytics-panel" aria-labelledby="progress-heading">
      <div className="analytics-section-heading">
        <div>
          <span className="analytics-kicker">Progress</span>
          <h2 id="progress-heading">Latest 8 vs previous 8</h2>
        </div>
        <b>Ruler V{progress.generation}</b>
      </div>
      <div className="analytics-comparison-grid">
        <div className="analytics-comparison-metric">
          <span>Goal reached</span>
          <strong>{progress.current.hitRate == null ? '—' : `${progress.current.hitRate}%`}</strong>
          <small>{signed(progress.outcomeDelta, ' pts')} · previous {progress.previous.hitRate == null ? '—' : `${progress.previous.hitRate}%`}</small>
        </div>
        <div className="analytics-comparison-metric">
          <span>Deep focus</span>
          <strong>{progress.current.deepFocusSeconds == null ? '—' : fmtDuration(progress.current.deepFocusSeconds)}</strong>
          <small>{signedDuration(progress.deepFocusDeltaSeconds)} · previous {progress.previous.deepFocusSeconds == null ? '—' : fmtDuration(progress.previous.deepFocusSeconds)}</small>
        </div>
        <div className="analytics-comparison-metric">
          <span>Measured time</span>
          <strong>{fmtDuration(progress.current.measuredSeconds)}</strong>
          <small>previous {fmtDuration(progress.previous.measuredSeconds)}</small>
        </div>
        <div className="analytics-comparison-metric">
          <span>Rated</span>
          <strong>{progress.current.ratedCount}/8</strong>
          <small>previous {progress.previous.ratedCount}/8</small>
        </div>
      </div>
    </section>
  )
}

function Interventions({ interventions }) {
  return (
    <section className="analytics-panel" aria-labelledby="interventions-heading">
      <div className="analytics-section-heading">
        <div>
          <span className="analytics-kicker">Interventions</span>
          <h2 id="interventions-heading">What the app did</h2>
        </div>
        <b>{interventions.sessions} sessions</b>
      </div>
      <div className="analytics-intervention-grid">
        <div><strong>{interventions.preDriftNudges}</strong><span>Drift-risk nudges</span></div>
        <div><strong>{interventions.gentleReminders}</strong><span>Gentle reminders</span></div>
        <div><strong>{interventions.alerts}</strong><span>Alerts</span></div>
        <div className={interventions.protectionEvents == null ? 'is-untracked' : ''}>
          <strong>{interventions.protectionEvents == null ? '—' : interventions.protectionEvents}</strong>
          <span>{interventions.protectionEvents == null ? 'Protection blocks · not tracked yet' : 'Protection blocks enforced'}</span>
        </div>
      </div>
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
      <OutcomeInbox sessions={story.unratedSessions} onRate={onUpdateSession} />
      <div className="analytics-story-lead">
        <Experiment experiment={story.experiment} onStartExperiment={onStartExperiment} />
        <Progress progress={story.progress} learning={story.learning} />
      </div>
      <Interventions interventions={story.interventions} />
      <section className="analytics-history" aria-labelledby="session-history-heading">
        <div className="analytics-section-heading">
          <div>
            <span className="analytics-kicker">Evidence</span>
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
