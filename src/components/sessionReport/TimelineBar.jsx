import { fmtClock } from '../../lib/sessionAnalysisPresentation'
import { PHASE_LABELS, PHASE_COLORS, ACTIVITY_KIND_LABELS } from './constants'
import { sessionPauseIntervals, sessionStartedAt, sessionWallSeconds, timelineWallSecond } from '../../lib/sessionTiming'

function scoreColor(score) {
  const r = Math.round(239 - (239 - 34) * (score / 100))
  const g = Math.round(68 + (197 - 68) * (score / 100))
  const b = Math.round(68 - (68 - 94) * (score / 100))
  return `rgb(${r},${g},${b})`
}

function pointTitle(pt, score, clock = null) {
  const activityKind = pt.activity?.kind
  return [
    `${clock ? `${clock} · ` : ''}${fmtClock(pt.second || 0)}: ${score}% focus`,
    pt.phase ? `Phase: ${PHASE_LABELS[pt.phase] || pt.phase}` : null,
    pt.preDrift ? 'Drift risk active' : null,
    activityKind ? `Activity: ${ACTIVITY_KIND_LABELS[activityKind] || activityKind}` : null,
  ].filter(Boolean).join(' | ')
}

function fmtTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// Per-second colored strip: red→green by score, phase color on the bottom
// border, dimmed while a drift-risk window is active. Shared by MeasuredFacts
// (the compact always-visible strip) and SessionDetails (same component, same
// data — there is only one timeline rendering in the app now).
export default function TimelineBar({ timeline = [], session = null, height = 12 }) {
  if (!timeline.length) return null

  const startedAt = sessionStartedAt(session)
  const wallSeconds = sessionWallSeconds(session)
  const wallTimeline = startedAt != null && wallSeconds > 0 && timeline.some(pt => Number.isFinite(pt?.wallSecond))

  if (wallTimeline) {
    const points = timeline
      .map(pt => ({ ...pt, wall: timelineWallSecond(pt) }))
      .filter(pt => pt.wall != null && Number.isFinite(pt.score) && pt.wall <= wallSeconds)
      .sort((a, b) => a.wall - b.wall)
    const pauses = sessionPauseIntervals(session)

    return (
      <div style={{ width: '100%' }}>
        <div style={{
          position: 'relative', width: '100%', height,
          borderRadius: 6, overflow: 'hidden',
          background: 'rgba(122,152,255,0.08)',
        }}>
          {points.map((pt, i) => {
            const previous = points[i - 1]
            const activeSpan = previous && Number.isFinite(pt.second) && Number.isFinite(previous.second)
              ? Math.min(5, Math.max(0, pt.second - previous.second))
              : Math.min(5, Math.max(0, pt.second || 5))
            const start = Math.max(0, pt.wall - activeSpan)
            const score = pt.score
            return (
              <div key={i} style={{
                position: 'absolute', left: `${(start / wallSeconds) * 100}%`,
                width: `${(Math.max(activeSpan, 0.25) / wallSeconds) * 100}%`, top: 0, bottom: 0,
                background: scoreColor(score),
                borderBottom: `3px solid ${PHASE_COLORS[pt.phase] || 'var(--text-muted)'}`,
                opacity: pt.preDrift ? 0.62 : 1,
              }} title={pointTitle(pt, score, fmtTime(startedAt + pt.wall * 1000))} />
            )
          })}
          {pauses.map((pause, i) => {
            const start = Math.max(0, (pause.startedAt - startedAt) / 1000)
            const end = Math.min(wallSeconds, (pause.endedAt - startedAt) / 1000)
            return (
              <div key={`pause-${i}`} style={{
                position: 'absolute', zIndex: 2, top: 0, bottom: 0,
                left: `${(start / wallSeconds) * 100}%`,
                width: `${((end - start) / wallSeconds) * 100}%`,
                background: 'repeating-linear-gradient(135deg, rgba(148,163,184,0.48) 0 4px, rgba(71,85,105,0.58) 4px 8px)',
              }} title={`Pause · ${fmtTime(pause.startedAt)}–${fmtTime(pause.endedAt)}`} />
            )
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtTime(startedAt)}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtTime(startedAt + wallSeconds * 1000)}</span>
        </div>
      </div>
    )
  }

  return (
    <div style={{ width: '100%' }}>
      <div style={{
        width: '100%', height,
        borderRadius: 6, overflow: 'hidden',
        display: 'flex', background: 'rgba(122,152,255,0.08)',
      }}>
        {timeline.map((pt, i) => {
          const s = pt.score != null ? pt.score : (pt.focused ? 80 : 20)
          const color = scoreColor(s)
          const phaseColor = PHASE_COLORS[pt.phase] || 'var(--text-muted)'
          return (
            <div key={i} style={{
              flex: 1, background: color, minWidth: 1,
              borderBottom: `3px solid ${phaseColor}`,
              opacity: pt.preDrift ? 0.62 : 1,
              borderRadius: i === 0 ? '6px 0 0 6px' : i === timeline.length - 1 ? '0 6px 6px 0' : 0,
            }} title={pointTitle(pt, s)} />
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
