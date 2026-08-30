import MeasuredFacts from './sessionReport/MeasuredFacts'
import CheckIn from './sessionReport/CheckIn'
import SessionRead from './sessionReport/SessionRead'
import SessionDetails from './sessionReport/SessionDetails'

/**
 * The one session report, rendered identically whether you just finished the
 * session (mode="post-session") or reopened it from Analytics → Sessions
 * (mode="history"). Four ordered sections: Measured facts, Quick check-in,
 * Session read, Details. Purely presentational plus the check-in form's own
 * local pending state — no storage import here, ever; persistence goes
 * through `onOutcomeChange`, which the caller wires to whatever repository
 * it's using.
 */
export default function SessionReport({
  session,
  analysis,
  mode = 'post-session',
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
        {mode === 'post-session' ? (
          <>
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
          </>
        ) : (
          <button className="restart-btn" onClick={onPrimaryAction}>
            Close
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
