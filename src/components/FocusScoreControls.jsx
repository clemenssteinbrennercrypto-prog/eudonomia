import { useEffect, useState } from 'react'
import { DEFAULT_FOCUS_WORKDAYS, scheduleForDay } from '../lib/focusScoreSchedule'
import { localDayKey } from '../lib/focusMetric'

const WEEKDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']]
const workdayNames = days => WEEKDAYS.filter(([day]) => days.includes(day)).map(([, name]) => name).join(', ')

export default function FocusScoreControls({ metricVersion, onVersionChange, scheduleState, now, showMetricVersions = true }) {
  const { schedule, error, saveWorkdays } = scheduleState
  const latest = schedule.plans.at(-1)
  const [workdays, setWorkdays] = useState(latest?.workdays ?? [...DEFAULT_FOCUS_WORKDAYS])
  useEffect(() => { setWorkdays(latest?.workdays ?? [...DEFAULT_FOCUS_WORKDAYS]) }, [latest])
  const today = localDayKey(now)
  const active = scheduleForDay(schedule, today)
  const pending = latest?.effectiveFrom > today ? latest : null
  const unchanged = latest && workdays.length === latest.workdays.length && workdays.every(day => latest.workdays.includes(day))

  return (
    <div className="focus-score-controls">
      {showMetricVersions && (
        <div className="lab-segments" role="group" aria-label="Focus Score formula">
          <button type="button" aria-pressed={metricVersion === 2} className={metricVersion === 2 ? 'is-active' : ''} onClick={() => onVersionChange(2)}>V2 · Current</button>
          <button type="button" aria-pressed={metricVersion === 1} className={metricVersion === 1 ? 'is-active' : ''} onClick={() => onVersionChange(1)}>V1 · Previous formula</button>
        </div>
      )}
      {metricVersion === 2 && (
        <details className="focus-workdays">
          <summary>Workdays: {active ? workdayNames(active.workdays) : 'not saved'}</summary>
          <p>Consistency starts {schedule.plans[0]?.effectiveFrom ?? 'when saved'}. Earlier days are not judged against this plan.</p>
          {pending && <p>From {pending.effectiveFrom}: {workdayNames(pending.workdays)}.</p>}
          <fieldset>
            <legend>Planned workdays</legend>
            {WEEKDAYS.map(([day, name]) => (
              <label key={day}>
                <input type="checkbox" checked={workdays.includes(day)} onChange={() => setWorkdays(previous => previous.includes(day) ? previous.filter(item => item !== day) : [...previous, day])} />
                {name}
              </label>
            ))}
          </fieldset>
          <button className="lab-text-action" type="button" disabled={workdays.length === 0 || (unchanged && !error)} onClick={() => saveWorkdays(workdays)}>
            {schedule.plans.length ? 'Save from tomorrow' : 'Save workdays'}
          </button>
          <p>Unselected days are rest days. Changes apply from tomorrow and preserve the plan that applied to earlier dates.</p>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
