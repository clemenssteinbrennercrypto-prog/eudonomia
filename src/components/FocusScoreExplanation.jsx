import { FOCUS_METRIC_V1 } from '../lib/focusMetric'
import { formatMinutes } from '../lib/durationFormat'

export function focusScoreLabel(period) {
  if (period.score == null) return 'Not measured'
  return 'Focus Score'
}

export default function FocusScoreExplanation({ period }) {
  const today = period.today
  const selectedDay = period.range === 'day' ? period.days[0] : null
  const statusDay = selectedDay || today
  const when = today && statusDay === today ? 'today' : 'this day'
  let status = null
  if (statusDay?.status === 'inactive') status = `No session ${when}.`
  if (statusDay?.status === 'unmeasured') status = `No qualifying measurement ${when}. A session needs at least ${formatMinutes(5)} of measured time.`
  if (statusDay?.status === 'different_generation') status = `Measurements ${when} use a different camera method and are excluded from this comparison.`
  if (statusDay?.status === 'future') status = 'This day is in the future.'
  if (!selectedDay && today?.status === 'measured') status = `Today’s score: ${today.score}.`
  if (!status && period.score == null) status = 'No qualifying measurements in this period.'

  return (
    <div className="focus-score-explanation">
      {status && <p>{status}</p>}
      {period.range !== 'day' && period.score != null && (
        <p>Only measured days enter this average. Days without sessions do not lower it.</p>
      )}
      <details>
        <summary>How this score works</summary>
        <p>Focus Score combines average attention with weighted focus time. It is a 1–100 index, not a percentage of time focused or a measure of completed work.</p>
        <p>Shorter days score lower at the same attention level. The duration adjustment reaches full weight at {formatMinutes(FOCUS_METRIC_V1.fullDayMinutes)} of measured time; weighted focus time still has diminishing returns after that.</p>
        <p>Average attention is the measured signal on a 0–100 scale. Weighted focus time gives each minute partial credit based on its focus phase; it is not literal time spent in deep focus.</p>
        <p>Focus Score uses estimated phase weights. A change of phase can lower the index even when average attention rises; use average attention to compare concentration alone.</p>
        <p>At least {formatMinutes(5)} of measured time in a session is required. Camera gaps earn no time. Sessions are assigned to their start date. Weekly and monthly values average qualifying daily scores equally; average attention is weighted by measured time.</p>
      </details>
    </div>
  )
}
