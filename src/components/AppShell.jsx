import { useEffect, useState } from 'react'

const ITEMS = [
  ['lab', 'Lab'],
  ['session-setup', 'Session'],
  ['setup', 'Workspace Setup'],
  ['ai-companion', 'AI Companion'],
  ['history', 'Analytics'],
]

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
  const time = now.toLocaleTimeString('en-GB', { hour12: false })
  return <span className="app-shell-clock" aria-label={`${date}, ${time}`}>{date}<b>{time}</b></span>
}

export default function AppShell({ active, onNavigate, utility, children }) {
  return (
    <div className="app-shell">
      <header className="app-shell-header">
        <button className="app-shell-brand" type="button" onClick={() => onNavigate('lab')}>Eudaimonia</button>
        <nav className="app-shell-nav" aria-label="Main navigation">
          {ITEMS.map(([id, label]) => {
            const disabled = id === 'ai-companion'
            return (
              <button
                key={id}
                type="button"
                className={`app-shell-nav-item${active === id ? ' is-active' : ''}`}
                onClick={() => !disabled && onNavigate(id)}
                disabled={disabled}
                aria-current={active === id ? 'page' : undefined}
                title={disabled ? 'AI Companion — coming later' : undefined}
              >
                {label}{disabled && <span className="app-shell-soon">Soon</span>}
              </button>
            )
          })}
        </nav>
        <div className="app-shell-utilities">
          <Clock />
          {utility}
        </div>
      </header>
      <div className="app-shell-body">{children}</div>
    </div>
  )
}
