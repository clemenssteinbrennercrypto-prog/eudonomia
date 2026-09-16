import TimelineBar from '../../sessionReport/TimelineBar'
import { fmtClock, fmtDuration } from '../../../lib/sessionAnalysisPresentation'
import { PHASE_LABELS, DISTRACTION_LABELS } from '../../sessionReport/constants'
import { sessionPauseIntervals, sessionStartedAt } from '../../../lib/sessionTiming'

const INTERVENTION_LABELS = {
  pre_drift_nudge: 'Drift-risk nudge',
  gentle_reminder: 'Gentle reminder',
  alert: 'Attention alert',
}

function buildEvents(session) {
  const events = []
  for (const transition of session.focusPhases?.transitions || []) {
    if (!Number.isFinite(transition?.second)) continue
    events.push({
      second: transition.second,
      kind: 'phase',
      label: `${PHASE_LABELS[transition.from] || transition.from || 'Start'} → ${PHASE_LABELS[transition.to] || transition.to}`,
      detail: 'Attention phase changed',
    })
  }
  const loggedAlerts = new Set()
  for (const event of session.phaseInterventions?.log || []) {
    if (!Number.isFinite(event?.second)) continue
    if (event.type === 'alert') loggedAlerts.add(`${event.second}:${event.reason || ''}`)
    events.push({
      second: event.second,
      kind: event.type === 'alert' ? 'alert' : 'nudge',
      label: INTERVENTION_LABELS[event.type] || event.type || 'Intervention',
      detail: event.reason ? (DISTRACTION_LABELS[event.reason] || event.reason) : (PHASE_LABELS[event.phase] || event.phase || ''),
    })
  }
  for (const event of session.distractionLog || []) {
    if (!Number.isFinite(event?.second) || loggedAlerts.has(`${event.second}:${event.reason || ''}`)) continue
    events.push({
      second: event.second,
      kind: 'alert',
      label: 'Attention alert',
      detail: DISTRACTION_LABELS[event.reason] || event.reason || 'Distraction detected',
    })
  }
  for (const event of session.protectionEvents || []) {
    if (!Number.isFinite(event?.second)) continue
    events.push({
      second: event.second,
      kind: 'protection',
      label: event.kind === 'domain_redirected' ? 'Blocked website redirected' : 'Blocked app hidden',
      detail: event.label || '',
    })
  }

  const startedAt = sessionStartedAt(session)
  if (startedAt != null) {
    for (const pause of sessionPauseIntervals(session)) {
      events.push({
        second: Math.max(0, (pause.startedAt - startedAt) / 1000),
        kind: 'pause',
        label: 'Break',
        detail: fmtDuration((pause.endedAt - pause.startedAt) / 1000),
      })
    }
  }
  return events.sort((a, b) => a.second - b.second)
}

export default function SessionTimeline({ session }) {
  const timeline = Array.isArray(session.timeline) ? session.timeline : []
  const events = buildEvents(session)
  return (
    <section className="analytics-session-timeline" aria-labelledby="session-timeline-heading">
      <div className="analytics-section-heading">
        <div>
          <span className="analytics-kicker">Chronology</span>
          <h2 id="session-timeline-heading">What happened, in order</h2>
        </div>
        <b>{timeline.length} samples</b>
      </div>
      {timeline.length > 0 ? (
        <TimelineBar timeline={timeline} session={session} height={54} />
      ) : (
        <p className="analytics-copy">No score timeline was stored for this session.</p>
      )}
      {events.length > 0 ? (
        <div className="analytics-event-list">
          {events.map((event, index) => (
            <div className={`analytics-event is-${event.kind}`} key={`${event.kind}-${event.second}-${index}`}>
              <time>{fmtClock(event.second)}</time>
              <i aria-hidden="true" />
              <div><strong>{event.label}</strong>{event.detail && <span>{event.detail}</span>}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="analytics-footnote">No phase changes, breaks, reminders, or alerts were stored.</p>
      )}
    </section>
  )
}
