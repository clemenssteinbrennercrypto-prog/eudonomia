import MeasuredFacts from './sessionReport/MeasuredFacts'
import CheckIn from './sessionReport/CheckIn'
import SessionRead from './sessionReport/SessionRead'
import SessionDetails from './sessionReport/SessionDetails'

/**
 * The post-session debrief. Four ordered sections: Measured facts, Quick
 * check-in, Session read, Details. Historical sessions deliberately use a
 * shorter overview. Persistence goes through `onOutcomeChange`; there is no
 * storage import here.
 */
export default function SessionReport({
  session,
  analysis,
  onOutcomeChange,
  onPrimaryAction,
  onSecondaryAction,
  onRepeat,
}) {
  const showRead = analysis.status !== 'awaiting_outcome'

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <MeasuredFacts session={session} analysis={analysis} />
      <CheckIn session={session} analysis={analysis} onOutcomeChange={onOutcomeChange} />
      {showRead && <SessionRead analysis={analysis} />}
      <SessionDetails session={session} analysis={analysis} />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button className="restart-btn" onClick={onPrimaryAction}>
          Continue to Analytics
        </button>
        {onSecondaryAction && (
          <button onClick={onSecondaryAction} style={secondaryButtonStyle}>
            New Session
          </button>
        )}
        {onRepeat && (
          <button onClick={onRepeat} style={secondaryButtonStyle}>
            Repeat Setup
          </button>
        )}
      </div>
    </div>
  )
}

const secondaryButtonStyle = {
  padding: '14px 28px',
  fontSize: 15, fontWeight: 600,
  background: 'transparent',
  color: 'var(--ultra-bright)',
  border: '1.5px solid var(--ultra)',
  borderRadius: 14,
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '0.01em',
}
