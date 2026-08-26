import { useMemo, useState } from 'react'
import { loadSessions } from '../lib/storage'
import { buildRecentSessionSetups, normalizeSessionTags, QUICK_SESSION_TAGS } from '../lib/sessionSetups'
import { countWords, limitWords, SESSION_PLAN_WORD_LIMIT } from '../lib/sessionPlan'
import { hasTimeLimit as isTimed, isCustomDuration } from '../lib/sessionDuration'

const DURATIONS = [15, 30, 60, 90]

export default function SessionIntentScreen({
  task,
  setTask,
  goal,
  setGoal,
  duration,
  setDuration,
  energyLevel,
  setEnergyLevel,
  tags,
  setTags,
  onStart,
}) {
  const [customTag, setCustomTag] = useState('')
  const [planOpen, setPlanOpen] = useState(false)
  const [customDurationOpen, setCustomDurationOpen] = useState(false)
  const recentSetups = useMemo(() => buildRecentSessionSetups(loadSessions()), [])
  const normalizedTags = normalizeSessionTags(tags)
  const canStart = task.trim().length > 0
  const planWordCount = countWords(goal)
  const hasTimeLimit = isTimed(duration)

  const toggleTag = (tag) => {
    setTags(previous => previous.includes(tag)
      ? previous.filter(item => item !== tag)
      : normalizeSessionTags([...previous, tag]))
  }

  const addCustomTag = () => {
    const [next] = normalizeSessionTags([customTag])
    if (!next) return
    setTags(previous => normalizeSessionTags([...previous, next]))
    setCustomTag('')
  }

  const applySetup = (setup) => {
    setTask(setup.task)
    setGoal(setup.goal)
    setDuration(setup.duration)
    setCustomDurationOpen(isCustomDuration(setup.duration, DURATIONS))
    setEnergyLevel(setup.energyLevel)
    setTags(setup.tags)
  }

  return (
    <main className="session-intent">
      <header className="session-intent-heading">
        <div>
          <span className="session-intent-kicker">Focus protocol · 01 / 03</span>
          <h1>Session Planning</h1>
          <p>Set a clear intention before the clock starts.</p>
        </div>
        <span className="session-intent-step">Intent</span>
      </header>

      <div className="session-intent-grid">
        <section className="session-intent-form" aria-label="Session intent">
          <label className="session-intent-field">
            <span>Session name</span>
            <input
              value={task}
              onChange={event => setTask(event.target.value.slice(0, 80))}
              placeholder="e.g. Draft the launch narrative"
              maxLength={80}
              autoFocus
            />
            <small>{task.length}/80</small>
          </label>

          <div className="session-intent-field session-plan-field">
            <span id="session-plan-field-label">Definition of plan <em>optional</em></span>
            <button type="button" className="session-plan-preview" aria-labelledby="session-plan-field-label" onClick={() => setPlanOpen(true)}>
              <span>{goal.trim() || 'Define what you will do and what “done” looks like.'}</span>
              <strong>{goal.trim() ? 'Edit plan' : 'Add plan'} ↗</strong>
            </button>
            <small>{planWordCount}/{SESSION_PLAN_WORD_LIMIT} words</small>
          </div>

          <fieldset className="session-intent-field">
            <legend>Tags <em>optional</em></legend>
            <div className="session-intent-tags">
              {QUICK_SESSION_TAGS.map(tag => (
                <button
                  key={tag}
                  type="button"
                  className={normalizedTags.includes(tag) ? 'is-selected' : ''}
                  aria-pressed={normalizedTags.includes(tag)}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              ))}
              {normalizedTags.filter(tag => !QUICK_SESSION_TAGS.includes(tag)).map(tag => (
                <button key={tag} type="button" className="is-selected" onClick={() => toggleTag(tag)}>
                  {tag} <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
            <div className="session-custom-tag">
              <input
                value={customTag}
                onChange={event => setCustomTag(event.target.value.slice(0, 24))}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addCustomTag()
                  }
                }}
                placeholder="Add custom tag"
                maxLength={24}
              />
              <button type="button" onClick={addCustomTag} disabled={!customTag.trim()}>Add</button>
            </div>
          </fieldset>

          <div className="session-intent-options">
            <fieldset>
              <legend>Duration</legend>
              <div>
                {DURATIONS.map(value => (
                  <button key={value} type="button" className={duration === value ? 'is-selected' : ''} onClick={() => setDuration(value)}>
                    {value}<span> min</span>
                  </button>
                ))}
                <button type="button" className={customDurationOpen && hasTimeLimit && !DURATIONS.includes(duration) ? 'is-selected' : ''} onClick={() => setCustomDurationOpen(true)}>
                  Custom
                </button>
                <button type="button" className={!hasTimeLimit ? 'is-selected' : ''} onClick={() => { setDuration(null); setCustomDurationOpen(false) }}>
                  No limit
                </button>
              </div>
              {customDurationOpen && (
                <label className="session-custom-duration">
                  <span>Minutes</span>
                  <input
                    type="number"
                    min="1"
                    max="720"
                    value={hasTimeLimit && !DURATIONS.includes(duration) ? duration : ''}
                    onChange={event => {
                      const value = Number(event.target.value)
                      if (Number.isFinite(value) && value > 0) setDuration(Math.min(720, Math.round(value)))
                    }}
                    placeholder="e.g. 45"
                    autoFocus
                  />
                </label>
              )}
            </fieldset>
            <fieldset>
              <legend>Energy <em>context only</em></legend>
              <div>
                {['fresh', 'medium', 'tired'].map(value => (
                  <button key={value} type="button" className={energyLevel === value ? 'is-selected' : ''} onClick={() => setEnergyLevel(value)}>
                    {value}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <button className="session-intent-start" type="button" disabled={!canStart} onClick={onStart}>
            <span className="session-start-icon" aria-hidden="true">▶</span>
            <span>Start focus session</span>
            <span className="session-start-duration">{hasTimeLimit ? `${duration} min` : 'No time limit'}</span>
          </button>
        </section>

        <aside className="session-recent-setups" aria-label="Recent session setups">
          <div className="session-recent-heading">
            <span>Recent setups</span>
            <small>{recentSetups.length ? 'Reuse a proven brief' : 'Your reusable briefs will appear here'}</small>
          </div>
          {recentSetups.length ? recentSetups.map((setup, index) => (
            <button key={`${setup.task}-${index}`} type="button" onClick={() => applySetup(setup)}>
              <span className="session-recent-index">0{index + 1}</span>
              <strong>{setup.task}</strong>
              <p>{setup.goal || 'No definition of done recorded'}</p>
              <div>
                <span>{setup.duration ? `${setup.duration} min` : 'No limit'}</span>
                {setup.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}
              </div>
            </button>
          )) : (
            <div className="session-recent-empty">
              <span>01</span>
              <p>Complete a session and its briefing becomes reusable here.</p>
            </div>
          )}
        </aside>
      </div>
      {planOpen && (
        <div className="session-plan-backdrop" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) setPlanOpen(false)
        }}>
          <section className="session-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="session-plan-title">
            <header>
              <div>
                <span>Session reference</span>
                <h2 id="session-plan-title">Session plan</h2>
              </div>
              <button type="button" aria-label="Close session plan" onClick={() => setPlanOpen(false)}>×</button>
            </header>
            <textarea
              value={goal}
              onChange={event => setGoal(limitWords(event.target.value))}
              placeholder="Write the steps, constraints, and the result you want to have by the end of this session…"
              autoFocus
            />
            <footer>
              <span>{planWordCount}/{SESSION_PLAN_WORD_LIMIT} words</span>
              <button type="button" onClick={() => setPlanOpen(false)}>Save plan</button>
            </footer>
          </section>
        </div>
      )}
    </main>
  )
}
