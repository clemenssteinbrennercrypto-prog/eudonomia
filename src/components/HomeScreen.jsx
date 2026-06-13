const DURATIONS = [15, 30, 60, 90]
const POSITIONS = ['Left', 'Right', 'Above', 'Below']

function MonitorPositionPicker({ label, value, onChange }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="duration-grid">
        {POSITIONS.map((pos) => (
          <button
            key={pos}
            className={`dur-btn${value === pos.toLowerCase() ? ' active' : ''}`}
            onClick={() => onChange(pos.toLowerCase())}
          >
            {pos}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function HomeScreen({
  task, setTask,
  duration, setDuration,
  monitors, setMonitors,
  monitorPositions, setMonitorPositions,
  onStart,
  onShowHistory,
}) {
  const setPosition = (index, pos) => {
    setMonitorPositions((prev) => {
      const next = [...prev]
      next[index] = pos
      return next
    })
  }

  return (
    <div className="screen-center">
      <div className="home-content">
        <div className="home-header" style={{ position: 'relative' }}>
          <button
            onClick={onShowHistory}
            style={{
              position: 'absolute', top: 0, right: 0,
              background: 'none', border: '1px solid #e5e7eb',
              borderRadius: 100, padding: '6px 14px',
              fontSize: 12, fontWeight: 500, color: '#6b7280',
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            History
          </button>
          <h1 className="app-title">Eudaimonia</h1>
          <p className="app-tagline">Stay present. Stay focused.</p>
        </div>

        <div className="home-form">
          <div className="field">
            <label className="field-label">What are you working on?</label>
            <input
              type="text"
              className="text-input"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="e.g. Writing my thesis introduction"
              autoFocus
            />
          </div>

          <div className="field">
            <label className="field-label">Duration</label>
            <div className="duration-grid">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  className={`dur-btn${duration === d ? ' active' : ''}`}
                  onClick={() => setDuration(d)}
                >
                  {d} min
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label">How many monitors?</label>
            <div className="duration-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {[1, 2, 3].map((m) => (
                <button
                  key={m}
                  className={`dur-btn${monitors === m ? ' active' : ''}`}
                  onClick={() => setMonitors(m)}
                >
                  {m === 3 ? '3+' : m}
                </button>
              ))}
            </div>
          </div>

          {monitors >= 2 && (
            <MonitorPositionPicker
              label="Where is your second monitor?"
              value={monitorPositions[0] ?? 'right'}
              onChange={(pos) => setPosition(0, pos)}
            />
          )}

          {monitors >= 3 && (
            <MonitorPositionPicker
              label="Where is your third monitor?"
              value={monitorPositions[1] ?? 'right'}
              onChange={(pos) => setPosition(1, pos)}
            />
          )}

          <button
            className="start-btn"
            onClick={onStart}
            disabled={!task.trim()}
          >
            Start Session
          </button>
        </div>
      </div>
    </div>
  )
}
