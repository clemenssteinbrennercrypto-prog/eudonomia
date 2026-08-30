import { useMemo } from 'react'
import { analyzeSession } from '../../../lib/sessionAnalysis'
import SessionReport from '../../SessionReport'

/**
 * Reopening a session from history renders through the exact same
 * SessionReport used right after the session ends (see EndScreen.jsx) — this
 * is what makes "post-session and historical detail render the same analysis
 * contract" true by construction rather than by convention.
 */
export default function SessionDetailView({ session, allSessions, onBack, onUpdateSession }) {
  const priorSessions = useMemo(
    () => allSessions.filter(s => s.id !== session.id),
    [allSessions, session.id]
  )
  const analysis = useMemo(
    () => analyzeSession(session, { priorSessions }),
    [session, priorSessions]
  )

  return (
    <SessionReport
      session={session}
      analysis={analysis}
      mode="history"
      onOutcomeChange={(patch) => onUpdateSession(session.id, patch)}
      onPrimaryAction={onBack}
    />
  )
}
