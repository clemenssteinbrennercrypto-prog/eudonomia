import { useEffect, useMemo, useState } from 'react'
import { sessionRepository } from '../lib/sessionRepository'
import { analyzeSession } from '../lib/sessionAnalysis'
import { durationFromSession } from '../lib/sessionDuration'
import SessionReport from './SessionReport'

/**
 * Thin wrapper: compute this session's analysis, keep it in sync as the
 * check-in is filled in, and hand everything to the shared SessionReport. All
 * the actual report logic/markup lives there and in sessionAnalysis.js —
 * this file only owns local state and post-session navigation.
 */
export default function EndScreen({ sessionData, onRestart, onPrimaryAction }) {
  const [session, setSession] = useState(sessionData)
  const [priorSessions, setPriorSessions] = useState([])

  // History is only needed for the personal-baseline sample size, which is a
  // secondary detail — so the report renders immediately with an empty
  // baseline and fills it in when the read resolves, rather than blocking on
  // storage before showing the user their own session.
  useEffect(() => {
    let cancelled = false
    sessionRepository.loadAll()
      .then(all => {
        if (!cancelled) setPriorSessions(all.filter(s => s.id !== session.id))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [session.id])

  const analysis = useMemo(
    () => analyzeSession(session, { priorSessions }),
    [session, priorSessions]
  )

  const handleOutcomeChange = (patch) => {
    // Applied locally first so the check-in feels instant and the session read
    // updates without waiting on the write.
    setSession(prev => ({ ...prev, ...patch }))
    if (session.id) {
      sessionRepository.updateSession(session.id, patch).catch(() => {})
    }
  }

  return (
    <div className="screen-center">
      <div className="end-content">
        <SessionReport
          session={session}
          analysis={analysis}
          mode="post-session"
          onOutcomeChange={handleOutcomeChange}
          onPrimaryAction={onPrimaryAction}
          onSecondaryAction={() => onRestart()}
          onRepeat={() => onRestart({
            task: session.task,
            goal: session.goal,
            energyLevel: session.energyLevel,
            duration: durationFromSession(session),
            tags: session.tags,
          })}
        />
      </div>
    </div>
  )
}
