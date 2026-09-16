import { FOCUS_METRIC_V1 } from '../lib/focusMetric'
import { FOCUS_METRIC_V2 } from '../lib/focusMetricV2'

export function focusScoreLabel(period) {
  if (period.score == null) return 'Not measured'
  if (period.metricVersion === 2) return period.range === 'day'
    ? 'Time × attention · v2'
    : `Time × attention × consistency · v2`
  return period.range === 'day'
    ? 'Daily score · v1'
    : `Average of ${period.activeDays} measured ${period.activeDays === 1 ? 'day' : 'days'} · v1`
}

export default function FocusScoreExplanation({ period }) {
  const v2 = period.metricVersion === 2
  const today = period.today
  const selectedDay = period.range === 'day' ? period.days[0] : null
  const statusDay = selectedDay || today
  const when = today && statusDay === today ? 'today' : 'this day'
  let status = null
  if (statusDay?.status === 'inactive') status = `No session ${when}.`
  if (statusDay?.status === 'unmeasured') status = `No qualifying measurement ${when}. A session needs at least 5 measured minutes.`
  if (statusDay?.status === 'different_generation') status = `Measurements ${when} use a different ruler and are excluded from this comparison.`
  if (statusDay?.status === 'future') status = 'This day is in the future.'
  if (!selectedDay && today?.status === 'measured') status = `Today’s score: ${today.score}.`
  if (!status && period.score == null) status = 'No qualifying measurements in this period.'

  return (
    <div className="focus-score-explanation">
      {status && <p>{status}</p>}
      {!v2 && period.range !== 'day' && period.score != null && (
        <p>Only measured days enter this average. Days without sessions do not lower it.</p>
      )}
      {v2 && period.range !== 'day' && period.score != null && (
        <p>
          {period.activeDays} measured {period.activeDays === 1 ? 'day' : 'days'} · Daily average {Math.round(period.dailyAverage)}
          {period.consistency.percent != null
            ? ` × ${Math.round(period.consistency.factor * 1000) / 10}% consistency factor ≈ ${period.score}.`
            : '. No eligible planned days yet; consistency has no effect.'}
        </p>
      )}
      {v2 && period.range !== 'day' && period.consistency.eligibleDays > 0 && (
        <p>Consistency: {period.consistency.completedDays}/{period.consistency.eligibleDays} eligible workdays measured ({period.consistency.percent}%). Today counts once measured; rest days are excluded.</p>
      )}
      {v2 && period.consistency.unknownDays > 0 && <p>{period.consistency.unknownDays} planned {period.consistency.unknownDays === 1 ? 'day has' : 'days have'} no qualifying measurement and {period.consistency.unknownDays === 1 ? 'is' : 'are'} excluded from consistency.</p>}
      <details>
        <summary>How this score works</summary>
        {v2 ? <>
          <p>V2 combines measured work time, average attention and consistency. Attention is the camera-based quality proxy, not a judgment of your work’s results.</p>
          <p>Daily score = average attention × time credit. Time credit grows smoothly: {FOCUS_METRIC_V2.referenceMinutes} measured minutes earn {FOCUS_METRIC_V2.referenceTimeCredit * 100}%; longer days add progressively less. Better attention at the same duration always improves the unrounded score.</p>
          <p>Weekly, monthly and yearly scores average measured daily scores, then multiply by a consistency factor between {(1 - FOCUS_METRIC_V2.consistencyWeight) * 100}% and 100%. Consistency is measured workdays divided by eligible planned workdays. A finished planned day with no session reduces it; an unfinished today, rest day or unmeasured session does not.</p>
          <p>A session needs at least 5 measured minutes. Camera gaps earn no time. Sessions belong to their start date. No measurements means no score; a genuine measured zero stays zero. Daily bars show daily scores before the period’s consistency adjustment.</p>
          <p>V2 recalculates from validated raw measurements, including historical ones. Saved V1 data stays unchanged and is available under “V1 · Previous formula”. V1 and V2 scores are different scales; camera generations are never mixed.</p>
        </> : <>
        <p>Focus Score combines average attention with weighted focus time. It is a 1–100 index, not a percentage of time focused or a measure of completed work.</p>
        <p>Shorter days score lower at the same attention level. The duration adjustment reaches full weight at {FOCUS_METRIC_V1.fullDayMinutes} measured minutes; weighted focus time still has diminishing returns after that.</p>
        <p>Average attention is the measured signal on a 0–100 scale. Weighted focus time gives each minute partial credit based on its focus phase; it is not literal time spent in deep focus.</p>
        <p>V1 uses estimated phase weights. A change of phase can lower the index even when average attention rises; use average attention to compare concentration alone.</p>
        <p>At least 5 measured minutes in a session are required. Camera gaps earn no time. Sessions are assigned to their start date. Weekly and monthly values average qualifying daily scores equally; average attention is weighted by measured time.</p>
        </>}
      </details>
    </div>
  )
}
