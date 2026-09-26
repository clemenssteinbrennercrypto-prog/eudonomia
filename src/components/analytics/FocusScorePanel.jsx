import { useMemo, useState } from 'react'
import { FOCUS_METRIC_V1, getFocusPeriodWindow } from '../../lib/focusMetric'
import { buildVersionedFocusPeriod } from '../../lib/focusMetricV2'
import { fmtDuration } from '../../lib/sessionAnalysisPresentation'
import { useCurrentTime } from '../../lib/useCurrentTime'
import FocusScoreExplanation, { focusScoreLabel } from '../FocusScoreExplanation'
import FocusScoreControls from '../FocusScoreControls'
import { useFocusScoreSchedule } from '../../lib/useFocusScoreSchedule'
import { formatMinutes } from '../../lib/durationFormat'

/**
 * The versioned daily Focus Score — distinct from a single session's "time
 * above threshold" (see MeasuredFacts.jsx). Both explicit metric versions use
 * the same qualified raw ledger, with V1 retained for historical comparison.
 */
export default function FocusScorePanel({ ledger, sessions }) {
  const [range, setRange] = useState('day')
  const [periodStart, setPeriodStart] = useState(null)
  const [metricVersion, setMetricVersion] = useState(2)
  const scheduleState = useFocusScoreSchedule()
  const now = useCurrentTime()
  const period = useMemo(
    () => buildVersionedFocusPeriod(ledger, { range, periodStart, sessions, now, metricVersion, schedule: scheduleState.schedule }),
    [ledger, sessions, range, periodStart, now, metricVersion, scheduleState.schedule]
  )
  const dayView = range === 'day'
  const measuredMinutes = Math.round(period.measuredSeconds / 60)
  const qualificationPct = dayView
    ? Math.min(100, Math.round((measuredMinutes / FOCUS_METRIC_V1.fullDayMinutes) * 100))
    : null
  const barWidth = range === 'year' ? 3 : range === 'month' ? 10 : 28
  const movePeriod = delta => {
    if (delta < 0) {
      setPeriodStart(getFocusPeriodWindow(range, -1, period.start).start.getTime())
    } else {
      const currentStart = getFocusPeriodWindow(range, 0, new Date(Date.now())).start
      setPeriodStart(period.endExclusive >= currentStart ? null : period.endExclusive.getTime())
    }
  }

  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 18, padding: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
            Focus Score
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '5px 0 0' }}>{period.title}</p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['day', 'week', 'month', 'year'].map(value => (
            <button
              key={value}
              type="button"
              onClick={() => { setRange(value); setPeriodStart(null) }}
              style={{
                border: range === value ? '1px solid var(--ultra)' : '1px solid var(--line)',
                borderRadius: 100, padding: '5px 11px',
                background: range === value ? 'var(--ultra)' : 'transparent',
                color: range === value ? '#fff' : 'var(--text-muted)',
                fontSize: 11, fontWeight: 700, textTransform: 'capitalize',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >{value}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 22 }}>
        <button
          type="button"
          onClick={() => movePeriod(-1)}
          aria-label={`Previous ${range}`}
          style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 100, color: 'var(--text-muted)', width: 32, height: 32, cursor: 'pointer' }}
        >←</button>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 64, lineHeight: 1, fontWeight: 300, letterSpacing: '-0.04em', color: period.score == null ? 'var(--text-muted)' : 'var(--ultra-bright)', margin: 0 }}>
            {period.score ?? '--'}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: '7px 0 0' }}>
            {focusScoreLabel(period)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => movePeriod(1)}
          disabled={!period.canGoForward}
          aria-label={`Next ${range}`}
          style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 100, color: period.canGoForward ? 'var(--text-muted)' : 'var(--line-strong)', width: 32, height: 32, cursor: period.canGoForward ? 'pointer' : 'default' }}
        >→</button>
      </div>

      <FocusScoreExplanation period={period} />
      <FocusScoreControls metricVersion={metricVersion} onVersionChange={setMetricVersion} scheduleState={scheduleState} now={now} />

      {period.score != null && (
        <>
          <div className="history-stats-grid" style={{ display: 'grid', gap: 10, marginTop: 22 }}>
            {[
              { label: 'Average attention', value: period.efficiency == null ? '--' : `${period.efficiency}/100` },
              { label: 'Measured', value: fmtDuration(period.measuredSeconds) },
              metricVersion === 2
                ? { label: 'Time credit', value: `${Math.round(period.timeCredit * 100)}%` }
                : { label: 'Weighted focus time', value: fmtDuration(Math.round(period.deepFocusMinutes * 60)) },
              metricVersion === 2 && !dayView
                ? { label: 'Consistency', value: period.consistency.percent == null ? '--' : `${period.consistency.percent}%` }
                : { label: 'Measured days', value: `${period.activeDays}/${period.elapsedDays}` },
            ].map(item => (
              <div key={item.label} style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 12, padding: '13px 8px', textAlign: 'center' }}>
                <p style={{ fontSize: 21, fontWeight: 300, color: 'var(--text)', margin: 0 }}>{item.value}</p>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, margin: '4px 0 0' }}>{item.label}</p>
              </div>
            ))}
          </div>

          {dayView && metricVersion === 1 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11, color: 'var(--text-muted)', marginBottom: 7 }}>
                <span>Duration adjustment</span>
                <span>{fmtDuration(period.measuredSeconds)} / {formatMinutes(FOCUS_METRIC_V1.fullDayMinutes)} measured</span>
              </div>
              <div style={{ height: 7, borderRadius: 999, overflow: 'hidden', background: 'rgba(122,152,255,0.08)' }}>
                <div style={{ width: `${qualificationPct}%`, height: '100%', borderRadius: 999, background: 'var(--ultra-bright)' }} />
              </div>
            </div>
          )}

          {!dayView && period.days.length > 0 && (
            <div style={{ overflowX: 'auto', marginTop: 18, paddingBottom: 2 }}>
              <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', minWidth: period.days.length * (barWidth + 3), height: 62 }}>
                {period.days.map(day => (
                  <div
                    key={day.key}
                    title={`${day.key}: ${day.status === 'inactive' ? 'no session' : day.status === 'future' ? 'future' : day.status === 'different_generation' ? 'different measurement method' : day.score == null ? 'not measured' : `${day.score} focus score`}`}
                    style={{
                      width: barWidth, minWidth: barWidth,
                      height: day.score == null ? 3 : Math.max(4, Math.round(day.score * 0.58)),
                      borderRadius: 3,
                      background: day.status !== 'measured' ? 'var(--line)' : 'var(--ultra-bright)',
                      opacity: day.status !== 'measured' ? 0.5 : 0.85,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap', marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            <span>{period.streak}d current streak</span>
            {period.baseline != null && <span>{period.score - period.baseline >= 0 ? '+' : ''}{period.score - period.baseline} vs your own baseline</span>}
            {metricVersion === 1 && <span>
              {period.totalMeasuredDays >= FOCUS_METRIC_V1.calibrationReviewDays
                ? 'Focus Score calibration review due'
                : `${period.totalMeasuredDays}/${FOCUS_METRIC_V1.calibrationReviewDays} days until calibration review`}
            </span>}
          </div>
        </>
      )}
    </section>
  )
}
