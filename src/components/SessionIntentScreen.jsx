import { useMemo, useState } from 'react'
import { loadSessions } from '../lib/storage'
import { buildRecentSessionSetups, normalizeSessionTags, QUICK_SESSION_TAGS } from '../lib/sessionSetups'

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
  const recentSetups = useMemo(() => buildRecentSessionSetups(loadSessions()), [])
  const normalizedTags = normalizeSessionTags(tags)
  const canStart = task.trim().length > 0

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

          <label className="session-intent-field">
            <span>Definition of done</span>
            <input
              value={goal}
              onChange={event => setGoal(event.target.value.slice(0, 120))}
              placeholder="What must exist when this session ends?"
              maxLength={120}
            />
            <small>{goal.length}/120</small>
          </label>

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
              </div>
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
            <span>Begin session</span>
            <span aria-hidden="true">→</span>
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
                <span>{setup.duration} min</span>
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
    </main>
  )
}
