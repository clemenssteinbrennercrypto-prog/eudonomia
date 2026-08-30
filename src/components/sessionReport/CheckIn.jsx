import { useState } from 'react'
import { GOAL_OUTCOMES } from './constants'

/**
 * The one required interaction in the post-session flow: did you reach the
 * goal? The note field adapts to the answer — "what did you complete" only
 * makes sense for a "yes", "what got in the way" only for "partly"/"no" — and
 * is always optional, unlike the outcome itself.
 */
export default function CheckIn({ session, analysis, onOutcomeChange }) {
  const [selectedOutcome, setSelectedOutcome] = useState(analysis.goalOutcome)
  const [completedText, setCompletedText] = useState(session.completedText || '')
  const [blockerText, setBlockerText] = useState(session.blockerText || '')

  const selectOutcome = (nextOutcome) => {
    setSelectedOutcome(nextOutcome)
    onOutcomeChange({
      goalOutcome: nextOutcome,
      goalAchieved: nextOutcome === 'yes' ? true : nextOutcome === 'no' ? false : null,
    })
  }

  const noteIsForCompletion = selectedOutcome === 'yes'
  const noteLabel = noteIsForCompletion ? 'What did you complete?' : 'What got in the way?'
  const noteValue = noteIsForCompletion ? completedText : blockerText
  const setNoteValue = noteIsForCompletion ? setCompletedText : setBlockerText
  const saveNote = () => onOutcomeChange(noteIsForCompletion
    ? { completedText: completedText.trim() }
    : { blockerText: blockerText.trim() })

  return (
    <div style={{
      width: '100%', boxSizing: 'border-box',
      background: 'var(--surface)',
      border: '1px solid var(--line)',
      borderRadius: 14,
      padding: '16px 18px',
    }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        Quick check-in <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(required)</span>
      </p>
      <p style={{ fontSize: 15, color: 'var(--text)', fontWeight: 600, margin: '0 0 12px' }}>
        {session.goal ? `Did you get there: ${session.goal}?` : 'Did you reach your goal?'}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: selectedOutcome ? 14 : 0 }}>
        {GOAL_OUTCOMES.map(({ value, label, color }) => {
          const active = selectedOutcome === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => selectOutcome(value)}
              aria-pressed={active}
              style={{
                padding: '9px 12px',
                fontSize: 13,
                fontWeight: 700,
                background: active ? `${color}22` : 'transparent',
                color: active ? color : 'var(--text-muted)',
                border: `1px solid ${active ? color : 'var(--line)'}`,
                borderRadius: 100,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>
      {selectedOutcome && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
            {noteLabel} <span style={{ fontWeight: 400 }}>(optional)</span>
          </span>
          <input
            type="text"
            className="text-input"
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value.slice(0, 160))}
            onBlur={saveNote}
            placeholder="Short note"
            maxLength={160}
          />
        </label>
      )}
    </div>
  )
}
