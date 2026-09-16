import { useEffect, useState } from 'react'
import {
  changeFocusScoreSchedule, DEFAULT_FOCUS_WORKDAYS, FOCUS_SCORE_SCHEDULE_KEY,
  loadFocusScoreSchedule, saveFocusScoreSchedule,
} from './focusScoreSchedule'

const CHANGED_EVENT = 'focus-score-schedule-changed'

export function useFocusScoreSchedule() {
  const [schedule, setSchedule] = useState(loadFocusScoreSchedule)
  const [error, setError] = useState(null)
  useEffect(() => {
    const refresh = () => setSchedule(loadFocusScoreSchedule())
    const onStorage = event => {
      if (event.key === FOCUS_SCORE_SCHEDULE_KEY || event.key === null) refresh()
    }
    window.addEventListener(CHANGED_EVENT, refresh)
    window.addEventListener('storage', onStorage)
    const stored = loadFocusScoreSchedule()
    if (stored.plans.length === 0) {
      try {
        saveFocusScoreSchedule(changeFocusScoreSchedule(stored, DEFAULT_FOCUS_WORKDAYS))
        window.dispatchEvent(new Event(CHANGED_EVENT))
      } catch { setError('Could not save workdays. Consistency is not applied until the plan is saved.') }
    }
    return () => {
      window.removeEventListener(CHANGED_EVENT, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const saveWorkdays = workdays => {
    try {
      const next = changeFocusScoreSchedule(loadFocusScoreSchedule(), workdays)
      saveFocusScoreSchedule(next)
      setError(null)
      window.dispatchEvent(new Event(CHANGED_EVENT))
      return true
    } catch (error) {
      setError(String(error?.message || 'Could not save workdays.'))
      return false
    }
  }
  return { schedule, error, saveWorkdays }
}
