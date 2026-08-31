import { useEffect, useMemo, useState } from 'react'
import { sessionRepository } from '../lib/sessionRepository'
import { analyzeSession } from '../lib/sessionAnalysis'
import { durationFromSession } from '../lib/sessionDuration'
import SessionReport from './SessionReport'

/**
 * Thin wrapper: analyse the session App hands down and render the shared
 * SessionReport. All report logic/markup lives there and in
 * sessionAnalysis.js.
 *
 * This deliberately keeps NO copy of the session. It used to, seeded once via
 * useState — and because the record reaches this screen before its save has
 * resolved, that copy never saw the storage id arrive and every check-in was
 * silently dropped. The session is a prop, the check-in goes back up to App,
 * and there is no second copy to fall out of step.
 */
export default function EndScreen({ sessionData, onOutcomeChange, onRestart, onPrimaryAction }) {
  const [priorSessions, setPriorSessions] = useState([])

  // History is only needed for the personal-baseline sample size, which is a
  // secondary detail — so the report renders immediately with an empty
  // baseline and fills it in when the read resolves, rather than blocking on
  // storage before showing the user their own session.
  useEffect(() => {
    let cancelled = false
    sessionRepository.loadAll()
      .then(all => {
        if (!cancelled) setPriorSessions(all.filter(s => s.id !== sessionData.id))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [sessionData.id])

  const analysis = useMemo(
    () => analyzeSession(sessionData, { priorSessions }),
    [sessionData, priorSessions]
  )

  return (
    <div className="screen-center">
      <div className="end-content">
        <SessionReport
          session={sessionData}
          analysis={analysis}
          mode="post-session"
          onOutcomeChange={onOutcomeChange}
          onPrimaryAction={onPrimaryAction}
          onSecondaryAction={() => onRestart()}
          onRepeat={() => onRestart({
            task: sessionData.task,
            goal: sessionData.goal,
            energyLevel: sessionData.energyLevel,
            duration: durationFromSession(sessionData),
            tags: sessionData.tags,
          })}
        />
      </div>
    </div>
  )
}
