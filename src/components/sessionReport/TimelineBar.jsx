import { fmtClock } from '../../lib/sessionAnalysisPresentation'
import { PHASE_LABELS, PHASE_COLORS, ACTIVITY_KIND_LABELS } from './constants'

// Per-second colored strip: red→green by score, phase color on the bottom
// border, dimmed while a drift-risk window is active. Shared by MeasuredFacts
// (the compact always-visible strip) and SessionDetails (same component, same
// data — there is only one timeline rendering in the app now).
export default function TimelineBar({ timeline = [], height = 12 }) {
  if (!timeline.length) return null

  return (
    <div style={{ width: '100%' }}>
      <div style={{
        width: '100%', height,
        borderRadius: 6, overflow: 'hidden',
        display: 'flex', background: 'rgba(122,152,255,0.08)',
      }}>
        {timeline.map((pt, i) => {
          const s = pt.score != null ? pt.score : (pt.focused ? 80 : 20)
          const r = Math.round(239 - (239 - 34) * (s / 100))
          const g = Math.round(68 + (197 - 68) * (s / 100))
          const b = Math.round(68 - (68 - 94) * (s / 100))
          const color = `rgb(${r},${g},${b})`
          const phaseColor = PHASE_COLORS[pt.phase] || 'var(--text-muted)'
          const activityKind = pt.activity?.kind
          const titleParts = [
            `${fmtClock(pt.second || 0)}: ${s}% focus`,
            pt.phase ? `Phase: ${PHASE_LABELS[pt.phase] || pt.phase}` : null,
            pt.preDrift ? 'Drift risk active' : null,
            activityKind ? `Activity: ${ACTIVITY_KIND_LABELS[activityKind] || activityKind}` : null,
          ].filter(Boolean)
          return (
            <div key={i} style={{
              flex: 1, background: color, minWidth: 1,
              borderBottom: `3px solid ${phaseColor}`,
              opacity: pt.preDrift ? 0.62 : 1,
              borderRadius: i === 0 ? '6px 0 0 6px' : i === timeline.length - 1 ? '0 6px 6px 0' : 0,
            }} title={titleParts.join(' | ')} />
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Start</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>End</span>
      </div>
    </div>
  )
}
