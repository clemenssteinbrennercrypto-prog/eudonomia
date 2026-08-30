import { useMemo, useState } from 'react'
import { HISTORY_TREND_RANGES, buildHistoryTrend } from '../../lib/historyTrend'

function focusColor(pct) {
  if (pct == null) return 'var(--text-muted)'
  if (pct >= 70) return 'var(--good)'
  if (pct >= 40) return 'var(--warn)'
  return 'var(--bad)'
}

/**
 * Time-above-threshold trend, bucketed by day/month. Ported from the old
 * HistoryDashboard's FocusTrends — with one deliberate removal: the dashed
 * "70%" reference line. The spec is explicit that this app compares a session
 * only against qualified personal history, never an arbitrary goal line.
 */
export default function TrendChart({ sessions }) {
  const [range, setRange] = useState('week')
  const [weekOffset, setWeekOffset] = useState(0)
  const trend = useMemo(
    () => buildHistoryTrend(sessions, { range, weekOffset }),
    [sessions, range, weekOffset]
  )
  const buckets = trend.buckets
  const MAX_H = 64
  const BAR_AREA_H = 82
  const showScores = buckets.length <= 14
  const labelEvery = range === '30days'
    ? 5
    : range === 'all'
      ? Math.max(1, Math.ceil(buckets.length / 12))
      : 1
  const minChartWidth = range === 'week' || range === 'year'
    ? '100%'
    : `${Math.max(640, buckets.length * (range === 'all' ? 40 : 28))}px`

  const changeRange = (nextRange) => {
    setRange(nextRange)
    setWeekOffset(0)
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: '20px 20px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
          Time above threshold — trend
        </p>
        {range === 'week' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              aria-label="Previous week"
              onClick={() => setWeekOffset(offset => offset - 1)}
              style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit' }}
            >←</button>
            <span style={{ minWidth: 126, textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
              {trend.title}
            </span>
            <button
              type="button"
              aria-label="Next week"
              disabled={!trend.canGoForward}
              onClick={() => setWeekOffset(offset => Math.min(0, offset + 1))}
              style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: trend.canGoForward ? 'var(--text-secondary)' : 'var(--line-strong)', cursor: trend.canGoForward ? 'pointer' : 'default', fontFamily: 'inherit' }}
            >→</button>
          </div>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{trend.title}</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {HISTORY_TREND_RANGES.map(option => (
          <button
            key={option.value}
            type="button"
            aria-pressed={range === option.value}
            onClick={() => changeRange(option.value)}
            style={{
              border: range === option.value ? '1px solid var(--ultra)' : '1px solid var(--line)',
              borderRadius: 100, padding: '5px 12px',
              fontSize: 11, fontWeight: 600,
              background: range === option.value ? 'var(--ultra)' : 'transparent',
              color: range === option.value ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ position: 'relative', minWidth: minChartWidth }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: buckets.length > 14 ? 3 : 6 }}>
            {buckets.map((bucket, i) => {
              const filled = bucket.avgFocus !== null
              const h = filled ? Math.max(4, Math.round((bucket.avgFocus / 100) * MAX_H)) : 4
              const color = filled ? focusColor(bucket.avgFocus) : 'var(--line)'
              const tooltip = filled
                ? `${bucket.dateLabel} — ${bucket.avgFocus}% of measured time above threshold, ${bucket.count} session${bucket.count !== 1 ? 's' : ''}`
                : `${bucket.dateLabel} — ${bucket.count ? `${bucket.count} unmeasured session${bucket.count !== 1 ? 's' : ''}` : 'no sessions'}`
              const showLabel = i % labelEvery === 0 || i === buckets.length - 1
              return (
                <div key={bucket.key} title={tooltip} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <span style={{ minHeight: 12, fontSize: 9, fontWeight: 600, color: filled && showScores ? 'var(--text-muted)' : 'transparent' }}>
                    {filled && showScores ? `${bucket.avgFocus}%` : '0'}
                  </span>
                  <div style={{ height: BAR_AREA_H, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', width: '100%' }}>
                    <div style={{ width: '100%', height: h, background: color, borderRadius: '6px 6px 0 0', minHeight: 4, transition: 'height 0.3s ease' }} />
                  </div>
                  <span style={{ minHeight: 14, fontSize: 9, color: showLabel ? 'var(--text-muted)' : 'transparent', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {showLabel ? bucket.label : '·'}
                  </span>
                  <span style={{ minHeight: 12, fontSize: 9, color: filled ? 'var(--line-strong)' : 'transparent', fontWeight: 500 }}>
                    {filled ? bucket.count : '0'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
