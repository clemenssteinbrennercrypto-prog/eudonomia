function fmt(seconds) {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function motivational(pct) {
  if (pct >= 80) return 'Outstanding session.'
  if (pct >= 60) return 'Solid work.'
  return 'Keep going. Every session counts.'
}

export default function EndScreen({ sessionData, onRestart }) {
  const {
    actualSeconds        = 0,
    focusedSeconds       = 0,
    distractionEvents    = 0,
    longestFocusedStreak = 0,
    timeline             = [],
    completed            = false,
  } = sessionData

  const focusPct = actualSeconds > 0 ? Math.round((focusedSeconds / actualSeconds) * 100) : 0

  return (
    <div className="screen-center">
      <div className="end-content">

        {/* Headline */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>
            {completed ? 'Session complete' : 'Session ended'}
          </p>
          <h1 className="end-headline">{motivational(focusPct)}</h1>
        </div>

        {/* Timeline bar */}
        {timeline.length > 0 && (
          <div style={{ width: '100%' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
              Focus timeline
            </p>
            <div style={{
              width: '100%', height: 8,
              borderRadius: 4, overflow: 'hidden',
              display: 'flex',
              background: '#f1f5f9',
            }}>
              {timeline.map((pt, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    background: pt.focused ? '#22c55e' : '#ef4444',
                    minWidth: 1,
                    transition: 'background 0.2s',
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>Start</span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>End</span>
            </div>
          </div>
        )}

        {/* Stats grid */}
        <div className="stats-row" style={{ flexWrap: 'wrap', justifyContent: 'center', rowGap: 32 }}>
          <div className="stat">
            <span className="stat-value">{fmt(actualSeconds)}</span>
            <span className="stat-label">total duration</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-value" style={{ color: focusPct >= 60 ? '#22c55e' : focusPct >= 40 ? '#f97316' : '#ef4444' }}>
              {focusPct}%
            </span>
            <span className="stat-label">focused</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-value">{distractionEvents}</span>
            <span className="stat-label">{distractionEvents === 1 ? 'alert' : 'alerts'}</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-value">{fmt(longestFocusedStreak)}</span>
            <span className="stat-label">longest streak</span>
          </div>
        </div>

        <button className="restart-btn" onClick={onRestart}>
          New Session
        </button>

      </div>
    </div>
  )
}
