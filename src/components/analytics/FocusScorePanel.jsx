import { useMemo, useState } from 'react'
import { buildFocusPeriod, FOCUS_METRIC_V1 } from '../../lib/focusMetric'
import { fmtDuration } from '../../lib/sessionAnalysisPresentation'

/**
 * The versioned daily Focus Score — distinct from a single session's "time
 * above threshold" (see MeasuredFacts.jsx). This is the same ledger-derived
 * number that used to live in HistoryDashboard's FocusScoreOverview, moved
 * here unchanged apart from styling: the number and its qualification rules
 * are untouched by this redesign.
 */
export default function FocusScorePanel({ ledger, sessions }) {
  const [range, setRange] = useState('day')
  const [offset, setOffset] = useState(0)
  const period = useMemo(
    () => buildFocusPeriod(ledger, { range, offset, sessions }),
    [ledger, sessions, range, offset]
  )
  const dayView = range === 'day'
  const measuredMinutes = Math.round(period.measuredSeconds / 60)
  const qualificationPct = dayView
    ? Math.min(100, Math.round((measuredMinutes / FOCUS_METRIC_V1.fullDayMinutes) * 100))
    : null
  const barWidth = range === 'year' ? 3 : range === 'month' ? 10 : 28

  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 18, padding: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
            Focus Score · v{FOCUS_METRIC_V1.version}
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '5px 0 0' }}>{period.title}</p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['day', 'week', 'month', 'year'].map(value => (
            <button
              key={value}
              type="button"
              onClick={() => { setRange(value); setOffset(0) }}
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
          onClick={() => setOffset(value => value - 1)}
          aria-label={`Previous ${range}`}
          style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 100, color: 'var(--text-muted)', width: 32, height: 32, cursor: 'pointer' }}
        >←</button>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 64, lineHeight: 1, fontWeight: 300, letterSpacing: '-0.04em', color: period.score == null ? 'var(--text-muted)' : 'var(--ultra-bright)', margin: 0 }}>
            {period.score ?? '--'}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: '7px 0 0' }}>
            {period.score == null ? 'Not measured' : dayView ? 'Daily focus score' : `${range} average`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOffset(value => Math.min(0, value + 1))}
          disabled={!period.canGoForward}
          aria-label={`Next ${range}`}
          style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 100, color: period.canGoForward ? 'var(--text-muted)' : 'var(--line-strong)', width: 32, height: 32, cursor: period.canGoForward ? 'pointer' : 'default' }}
        >→</button>
      </div>

      {period.score == null ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.55, margin: '18px auto 4px', maxWidth: 440 }}>
          Focus Score starts with the next session that has at least 5 measured minutes. Older sessions without raw measurements are not estimated.
        </p>
      ) : (
        <>
          <div className="history-stats-grid" style={{ display: 'grid', gap: 10, marginTop: 22 }}>
            {[
              { label: 'Efficiency', value: period.efficiency == null ? '--' : `${period.efficiency}%` },
              { label: 'Measured', value: fmtDuration(period.measuredSeconds) },
              { label: 'Deep focus', value: fmtDuration(Math.round(period.deepFocusMinutes * 60)) },
              { label: 'Consistency', value: `${period.activeDays}/${period.elapsedDays}` },
            ].map(item => (
              <div key={item.label} style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 12, padding: '13px 8px', textAlign: 'center' }}>
                <p style={{ fontSize: 21, fontWeight: 300, color: 'var(--text)', margin: 0 }}>{item.value}</p>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, margin: '4px 0 0' }}>{item.label}</p>
              </div>
            ))}
          </div>

          {dayView && (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11, color: 'var(--text-muted)', marginBottom: 7 }}>
                <span>Full-day qualification</span>
                <span>{measuredMinutes} / {FOCUS_METRIC_V1.fullDayMinutes} measured min</span>
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
                    title={`${day.key}: ${day.score == null ? 'not measured' : `${day.score} focus score`}`}
                    style={{
                      width: barWidth, minWidth: barWidth,
                      height: day.score == null ? 3 : Math.max(4, Math.round(day.score * 0.58)),
                      borderRadius: 3,
                      background: day.score == null ? 'var(--line)' : 'var(--ultra-bright)',
                      opacity: day.score == null ? 0.5 : 0.85,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap', marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            <span>{period.streak}d current streak</span>
            {period.baseline != null && <span>{period.score - period.baseline >= 0 ? '+' : ''}{period.score - period.baseline} vs your own baseline</span>}
            <span>
              {period.totalMeasuredDays >= FOCUS_METRIC_V1.calibrationReviewDays
                ? 'V1 calibration review due'
                : `${period.totalMeasuredDays}/${FOCUS_METRIC_V1.calibrationReviewDays} days until calibration review`}
            </span>
          </div>
        </>
      )}
    </section>
  )
}
