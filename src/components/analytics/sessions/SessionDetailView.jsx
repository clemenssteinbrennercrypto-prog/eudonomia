import { useMemo } from 'react'
import { analyzeSession, SESSION_ANALYSIS_VERSION } from '../../../lib/sessionAnalysis'
import SessionOverview from './SessionOverview'

/**
 * History is intentionally shorter than the immediate post-session debrief:
 * one compact overview, a duration-only attention breakdown, and the editable
 * outcome. Raw timelines and audit data remain in the stored/exported record.
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
      <SessionOverview
        session={session}
        analysis={analysis}
        onUpdateSession={(patch) => onUpdateSession(session.id, patch)}
      />
    </div>
  )
}
