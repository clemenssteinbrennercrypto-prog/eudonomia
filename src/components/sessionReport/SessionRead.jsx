import { describeConclusion, describeNextAction } from '../../lib/sessionAnalysisPresentation'

/**
 * One plain conclusion, its strongest supporting note, and exactly one
 * recommendation. Renders once the check-in is done (status 'ready' or
 * 'facts_only') — never before, since there is nothing evidence-based to say
 * until the outcome is known.
 */
export default function SessionRead({ analysis }) {
  if (analysis.status === 'facts_only') {
    return (
      <div style={{
        width: '100%', boxSizing: 'border-box',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 14,
        padding: '16px 18px',
      }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
          Session read
        </p>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
          This session was too short to draw a conclusion from. Your check-in was saved.
        </p>
      </div>
    )
  }

  const read = describeConclusion(analysis.conclusion, analysis.facts)
  const action = describeNextAction(analysis.nextAction)
  if (!read) return null

  return (
    <div style={{
      width: '100%', boxSizing: 'border-box',
      background: 'var(--surface)',
      border: '1px solid var(--line)',
      borderRadius: 14,
      padding: '16px 18px',
    }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
        Session read
      </p>
      <p style={{ fontSize: 15, color: 'var(--text)', fontWeight: 600, lineHeight: 1.45, margin: '0 0 8px' }}>
        {read.headline}
      </p>
      {read.note && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45, margin: 0 }}>
          {read.note}
        </p>
      )}
      {action && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
            Next session
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45, margin: 0 }}>
            {action}
          </p>
        </div>
      )}
    </div>
  )
}
