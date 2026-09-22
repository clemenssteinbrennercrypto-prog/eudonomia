import { useMemo } from 'react'
import { analyzeSession, SESSION_ANALYSIS_VERSION } from '../../../lib/sessionAnalysis'
import SessionReport from '../../SessionReport'
import SessionTimeline from './SessionTimeline'
import WhyThisResult from './WhyThisResult'

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
    () => session.analysisSnapshot?.version === SESSION_ANALYSIS_VERSION
      ? session.analysisSnapshot
      : analyzeSession(session, { priorSessions }),
    [session, priorSessions]
  )

  return (
    <div className="analytics-session-detail">
      <button type="button" className="analytics-detail-back" onClick={onBack}>← Session history</button>
      <SessionTimeline session={session} />
      <WhyThisResult session={session} analysis={analysis} />
      <SessionReport
        session={session}
        analysis={analysis}
        mode="history"
        hideTimeline
        onOutcomeChange={(patch) => onUpdateSession(session.id, patch)}
        onPrimaryAction={onBack}
      />
    </div>
  )
}
