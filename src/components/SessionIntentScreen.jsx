import { useMemo, useState } from 'react'
import { buildRecentSessionSetups, normalizeSessionTags, QUICK_SESSION_TAGS } from '../lib/sessionSetups'
import { countWords, limitWords, SESSION_PLAN_WORD_LIMIT } from '../lib/sessionPlan'
import { hasTimeLimit as isTimed, isCustomDuration } from '../lib/sessionDuration'
import { CLOUD_GOAL_MAX_CHARS } from '../lib/intentContract'
import { getProtectionReadiness } from '../lib/protectionReadiness'
import { useCompanionStatus } from '../lib/useCompanionStatus'
import { formatMinutes } from '../lib/durationFormat'

const DURATIONS = [15, 30, 60, 90]

export default function SessionIntentScreen({
  // Past sessions, used only for the "reuse a recent setup" shortcuts. Owned
  // and loaded by App so this screen stays a pure render.
  recentSessions = [],
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
  workspaces = [],
  activeWorkspaceId = null,
  contractProvider = 'keywords',
  protectionSetup = null,
  protectionSetups = [],
  protectionEnabled = false,
  // Optional override for the Companion check (tests, previews). Without it the
  // screen polls the Companion itself while protection is switched on.
  nativeStatus = null,
  onProtectionSetupChange,
  onEditProtection,
  onWorkspaceChange,
  onEditWorkspaces,
  onStart,
}) {
  const [customTag, setCustomTag] = useState('')
  const [planOpen, setPlanOpen] = useState(false)
  const [customDurationOpen, setCustomDurationOpen] = useState(false)
  const recentSetups = useMemo(() => buildRecentSessionSetups(recentSessions), [recentSessions])
  const normalizedTags = normalizeSessionTags(tags)
  const canStart = task.trim().length > 0
  const planWordCount = countWords(goal)
  const hasTimeLimit = isTimed(duration)
  const cloudPlanSharing = contractProvider === 'cloud'
  const polledCompanionStatus = useCompanionStatus({ enabled: protectionEnabled && nativeStatus == null, intervalMs: 5000 })
  const protection = getProtectionReadiness({
    enabled: protectionEnabled,
    setup: protectionSetup,
    nativeStatus: nativeStatus ?? polledCompanionStatus,
  })
  const protectedDistractions = protection.distractionCount
  const strictProtection = protection.strictMode
  const protectionReady = protection.state === 'ready'
  const protectionConfigured = protection.state !== 'off' && protection.state !== 'empty'
  const distractionLabel = `${protectedDistractions} ${protectedDistractions === 1 ? 'distraction' : 'distractions'}`
  const setupName = protectionSetup?.name || 'Protection'
  const protectionHeadline = {
    off: 'Protection off',
    empty: 'Not configured',
    checking: `${setupName} · checking Companion`,
    disconnected: `${setupName} · Companion not connected`,
    permission: `${setupName} · permission required`,
    helper: `${setupName} · website helper required`,
    ready: `${setupName} · protected`,
  }[protection.state]
  const protectionDetail = {
    off: 'This session will not enforce your protection rules.',
    empty: 'Choose what should step out of the way before you begin.',
    checking: 'Verifying that the Companion can enforce these rules.',
    disconnected: 'Rules are set, but nothing is enforced until the Companion app is running.',
    permission: protection.permissionScope === 'system'
      ? `Nothing is enforced until the Companion has Automation access for ${protection.permissionMissing}.`
      : `Blocked websites can't be closed in ${protection.permissionMissing} until the Companion has Automation access.`,
    helper: 'Install the website blocking helper in Protection so websites can be blocked.',
    ready: strictProtection
      ? `Strict protection · unlisted apps hidden · ${protectedDistractions} selected ${protectedDistractions === 1 ? 'distraction' : 'distractions'} unavailable`
      : `${distractionLabel} unavailable during this session`,
  }[protection.state]

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

      <div className="session-workspace-selector">
        <div className="session-workspace-copy">
          <span>Active workspace</span>
          <small id="session-workspace-help">Spatial context used by focus tracking</small>
        </div>
        <span className="session-select-control">
          <select aria-label="Active workspace" aria-describedby="session-workspace-help" value={activeWorkspaceId || ''} onChange={event => onWorkspaceChange?.(event.target.value)}>
            {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </span>
        <button type="button" onClick={onEditWorkspaces}>Manage</button>
      </div>

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
            {cloudPlanSharing && (
              <small className="session-plan-cloud-summary">
                Cloud active: the first {CLOUD_GOAL_MAX_CHARS} characters are sent to Anthropic;
                session name, tags and activity stay local.
              </small>
            )}
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
                    {formatMinutes(value)}
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

          <section className={`session-protection-summary is-${protection.state}${protectionReady ? ' is-ready' : ''}`} aria-label="Focus protection">
            <span className="session-protection-icon" aria-hidden="true"><i /></span>
            <div>
              <small>Focus environment</small>
              <strong>{protectionHeadline}</strong>
              <p>{protectionDetail}</p>
            </div>
            <div className="session-protection-actions">
              {protectionSetups.length > 1 && onProtectionSetupChange && (
                <span className="session-select-control">
                  <select
                    aria-label="Protection setup"
                    value={protectionSetup?.id || ''}
                    onChange={event => onProtectionSetupChange(event.target.value)}
                  >
                    {protectionSetups.map(setup => <option key={setup.id} value={setup.id}>{setup.name}</option>)}
                  </select>
                </span>
              )}
              {onEditProtection && <button type="button" onClick={onEditProtection}>{protectionConfigured ? 'Edit' : 'Set up'}</button>}
            </div>
          </section>

          <button className="session-intent-start" type="button" disabled={!canStart} onClick={onStart}>
            <span className="session-start-icon" aria-hidden="true">▶</span>
            <span>{protectionReady ? 'Start protected session' : 'Start focus session'}</span>
            <span className="session-start-duration">{hasTimeLimit ? formatMinutes(duration) : 'No time limit'}</span>
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
                <span>{setup.duration ? formatMinutes(setup.duration) : 'No limit'}</span>
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
              aria-describedby={cloudPlanSharing ? 'session-plan-cloud-disclosure' : undefined}
              autoFocus
            />
            {cloudPlanSharing && (
              <p id="session-plan-cloud-disclosure" className="session-plan-cloud-disclosure" role="note">
                Cloud is active. The first {CLOUD_GOAL_MAX_CHARS} characters are sent to Anthropic
                when the session starts. The session name, tags and session activity stay local.
              </p>
            )}
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
