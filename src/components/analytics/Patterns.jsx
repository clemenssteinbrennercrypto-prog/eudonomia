import { useMemo } from 'react'
import { calibrate, outcomeFit, MIN_SESSIONS } from '../../lib/calibration'

// Every axis here shares calibration.js's {ranked, best, worst} shape. Only
// the ones built on rankBuckets() qualify for the generic card — duration and
// planning have their own shapes and get dedicated cards below.
const BUCKET_AXES = [
  { kind: 'time_of_day', resultKey: 'timeOfDay', title: 'Time of day' },
  { kind: 'weekday', resultKey: 'weekday', title: 'Day of week' },
  { kind: 'workspace', resultKey: 'workspace', title: 'Workspace & setup' },
  { kind: 'energy', resultKey: 'energy', title: 'Energy context' },
  { kind: 'drift_recovery', resultKey: 'driftRecovery', title: 'Drift & recovery' },
  { kind: 'activity_alignment', resultKey: 'activityAlignment', title: 'Activity alignment' },
  { kind: 'output_evidence', resultKey: 'outputEvidence', title: 'Output evidence' },
]

const cardStyle = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px' }
const titleStyle = { fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase', margin: '0 0 8px' }
const bodyStyle = { fontSize: 13.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }
const mutedStyle = { fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }

/** Every comparison shows its sample size — this crosses a qualified best/
 *  worst condition bucket against goal outcomes, so a focus-% difference is
 *  never presented alone when an outcome difference can also be checked. */
function OutcomeCrossReference({ best, worst }) {
  const bestOutcome = outcomeFit(best.sessions || [])
  const worstOutcome = outcomeFit(worst.sessions || [])
  if (!bestOutcome || !worstOutcome) {
    return <p style={{ ...mutedStyle, marginTop: 8 }}>Not enough rated sessions in each condition yet to compare goal outcomes.</p>
  }
  return (
    <p style={{ ...mutedStyle, marginTop: 8 }}>
      Goal reached in {bestOutcome.hitRate}% of "{best.label}" sessions ({bestOutcome.n} rated) vs {worstOutcome.hitRate}% of "{worst.label}" sessions ({worstOutcome.n} rated).
    </p>
  )
}

function BucketAxisCard({ title, result, insightText }) {
  const hasSignal = result?.best && result?.worst
  return (
    <div style={cardStyle}>
      <p style={titleStyle}>{title}</p>
      {hasSignal ? (
        <>
          <p style={bodyStyle}>{insightText}</p>
          <OutcomeCrossReference best={result.best} worst={result.worst} />
        </>
      ) : result?.ranked?.length ? (
        <p style={mutedStyle}>
          Not enough of a difference yet — {result.ranked.map(r => `${r.label} (${r.n})`).join(', ')}.
        </p>
      ) : (
        <p style={mutedStyle}>Not enough sessions with this data yet.</p>
      )}
    </div>
  )
}

function DurationCard({ duration }) {
  return (
    <div style={cardStyle}>
      <p style={titleStyle}>Planned duration</p>
      {duration?.shorterIsBetter ? (
        <p style={bodyStyle}>
          {duration.shorterIsBetter.best.minutes}-minute sessions hold {duration.shorterIsBetter.best.focusPct}% focus; your {duration.shorterIsBetter.longest.minutes}-minute ones drop to {duration.shorterIsBetter.longest.focusPct}%.
        </p>
      ) : duration?.ranked?.length ? (
        <p style={mutedStyle}>
          No planned length clearly outperforms another yet — {duration.ranked.map(r => `${r.minutes}min (${r.n})`).join(', ')}.
        </p>
      ) : (
        <p style={mutedStyle}>Not enough sessions at more than one planned length yet.</p>
      )}
    </div>
  )
}

function PlanningCard({ planning }) {
  return (
    <div style={cardStyle}>
      <p style={titleStyle}>Planning accuracy</p>
      {planning ? (
        planning.ratio < 0.7 ? (
          <p style={bodyStyle}>
            You plan {planning.plannedMedian} minutes but typically run {planning.actualMedian} ({planning.n} sessions that ended early).
          </p>
        ) : (
          <p style={mutedStyle}>
            You plan about as long as you actually run ({planning.n} sessions that ended early).
          </p>
        )
      ) : (
        <p style={mutedStyle}>Not enough sessions that ended before their timer yet to measure planning accuracy.</p>
      )}
    </div>
  )
}

/**
 * Patterns prioritizes goal outcomes vs conditions: an overall hit-rate card
 * first, then one card per axis — each showing sample sizes and, once a
 * focus-based signal exists, whether the outcome rate differs too. Anything
 * that doesn't clear calibration.js's refusal thresholds shows the honest
 * qualification state instead of a claim.
 */
export default function Patterns({ sessions }) {
  const safeSessions = Array.isArray(sessions) ? sessions : []
  const calibration = useMemo(() => calibrate(safeSessions), [safeSessions])
  const overallOutcome = useMemo(() => outcomeFit(safeSessions.filter(s => s.goalOutcome)), [safeSessions])

  if (!calibration.ready) {
    return (
      <div style={cardStyle}>
        <p style={bodyStyle}>
          {calibration.needMore} more measured {calibration.needMore === 1 ? 'session' : 'sessions'} (of {MIN_SESSIONS} needed) before any pattern can be named honestly — {calibration.sessionsAnalysed} qualified so far.
        </p>
      </div>
    )
  }

  const insightByKind = Object.fromEntries(calibration.insights.map(i => [i.kind, i]))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={cardStyle}>
        <p style={titleStyle}>Goal outcomes</p>
        <p style={bodyStyle}>
          {overallOutcome
            ? `You reach the goal you set in ${overallOutcome.hitRate}% of ${overallOutcome.n} rated sessions.`
            : 'Not enough rated sessions yet to compute a hit rate.'}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {BUCKET_AXES.map(axis => (
          <BucketAxisCard
            key={axis.kind}
            title={axis.title}
            result={calibration[axis.resultKey]}
            insightText={insightByKind[axis.kind]?.text}
          />
        ))}
        <DurationCard duration={calibration.duration} />
        <PlanningCard planning={calibration.planning} />
        <div style={cardStyle}>
          <p style={titleStyle}>Blocking</p>
          <p style={mutedStyle}>Not tracked per session yet, so no comparison can be made here.</p>
        </div>
      </div>
    </div>
  )
}
