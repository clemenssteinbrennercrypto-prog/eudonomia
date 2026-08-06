import { useMemo, useState } from 'react'
import { derivePlan } from '../lib/intentContract'
import { suggestedSessionMinutes } from '../lib/calibration'
import {
  DEFAULT_STEP_MINUTES,
  addStep,
  createProject,
  moveStep,
  removeStep,
  resizeOpenSteps,
} from '../lib/project'
import {
  loadContractSettings,
  loadSessions,
  saveProject,
  setActiveProject,
} from '../lib/storage'

// Planning a project. The app proposes; the person corrects. That order matters
// — a form asks you to produce the plan, a guide hands you a draft to react to,
// which is far less work and far easier to disagree with.

export default function ProjectScreen({ onDone, onCancel }) {
  const [title, setTitle] = useState('')
  const [thinking, setThinking] = useState(false)
  const [draft, setDraft] = useState(null)     // a Project, pre-save
  const [planSource, setPlanSource] = useState(null)
  const [newStep, setNewStep] = useState('')

  // Step length comes from measurement. Until history can say, it stays the
  // default and the UI says so rather than implying it was chosen for you.
  const sizing = useMemo(() => suggestedSessionMinutes(loadSessions()), [])
  const stepMinutes = sizing?.minutes ?? DEFAULT_STEP_MINUTES

  const propose = async () => {
    const goal = title.trim()
    if (!goal || thinking) return
    setThinking(true)
    try {
      const settings = loadContractSettings()
      const plan = await derivePlan(
        { task: goal, goal },
        {
          provider: settings.provider,
          model: settings.provider === 'cloud' ? settings.cloudModel : settings.localModel,
          endpoint: settings.localEndpoint,
          apiKey: settings.apiKey,
        }
      )
      const project = createProject({
        title: goal,
        kind: plan?.kind || 'general',
        source: plan?.source || 'keywords',
        steps: (plan?.steps || []).map(s => ({ label: s.label, note: s.note, minutes: stepMinutes })),
      })
      setPlanSource(plan?.source === 'keywords' ? 'template' : plan?.source)
      setDraft(project)
    } finally {
      setThinking(false)
    }
  }

  const start = () => {
    if (!draft) return
    const saved = saveProject(resizeOpenSteps(draft, stepMinutes))
    setActiveProject(saved.id)
    onDone?.(saved)
  }

  return (
    <div className="screen-center">
      <div className="home-content">
        <div className="home-header">
          <p className="app-tagline">Plan a project</p>
          <h1 className="app-title" style={{ fontSize: 30 }}>
            {draft ? 'Here is a first pass' : 'What are you working toward?'}
          </h1>
        </div>

        <div className="home-form">
          {!draft ? (
            <>
              <div className="field">
                <label className="field-label">The goal</label>
                <input
                  type="text"
                  className="text-input"
                  value={title}
                  autoFocus
                  onChange={e => setTitle(e.target.value.slice(0, 160))}
                  onKeyDown={e => { if (e.key === 'Enter') propose() }}
                  placeholder="e.g. Finish the intro chapter of my thesis"
                />
                <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.5 }}>
                  Something that takes more than one sitting. It gets broken into sessions —
                  you can change every one of them.
                </p>
              </div>

              <button
                type="button"
                className="start-btn"
                disabled={!title.trim() || thinking}
                onClick={propose}
                style={{ opacity: !title.trim() || thinking ? 0.5 : 1 }}
              >
                {thinking ? 'Working it out…' : 'Propose a plan'}
              </button>
            </>
          ) : (
            <>
              <div className="field">
                <label className="field-label">
                  {draft.steps.length} sessions · {stepMinutes} min each
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {draft.steps.map((s, i) => (
                    <div
                      key={s.id}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '10px 12px',
                        border: '1px solid var(--line)', borderRadius: 12,
                      }}
                    >
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                        minWidth: 16, paddingTop: 2, fontVariantNumeric: 'tabular-nums',
                      }}>
                        {i + 1}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13.5, color: 'var(--text)', margin: 0, lineHeight: 1.4 }}>
                          {s.label}
                        </p>
                        {s.note && (
                          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '3px 0 0', lineHeight: 1.4 }}>
                            {s.note}
                          </p>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                        <StepButton label="↑" onClick={() => setDraft(moveStep(draft, s.id, -1))} />
                        <StepButton label="↓" onClick={() => setDraft(moveStep(draft, s.id, 1))} />
                        <StepButton label="×" onClick={() => setDraft(removeStep(draft, s.id))} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="field">
                <input
                  type="text"
                  className="text-input"
                  value={newStep}
                  onChange={e => setNewStep(e.target.value.slice(0, 120))}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newStep.trim()) {
                      setDraft(addStep(draft, newStep.trim(), { minutes: stepMinutes }))
                      setNewStep('')
                    }
                  }}
                  placeholder="Add a step…"
                  style={{ fontSize: 13 }}
                />
              </div>

              {/* Be honest about where the plan came from and what sized it. */}
              <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
                {planSource === 'template'
                  ? 'This is a generic outline for this kind of work, not a plan for your specific goal — turn on goal understanding in Focus Apps for something better.'
                  : 'Proposed by your goal-understanding model.'}
                {' '}
                {sizing
                  ? `Sessions are ${stepMinutes} minutes because that is where your focus measurably holds (${sizing.focusPct}% across ${sizing.n} sessions).`
                  : `Sessions default to ${stepMinutes} minutes until enough history exists to size them to you.`}
              </p>

              <button type="button" className="start-btn" onClick={start} disabled={!draft.steps.length}>
                Start this project
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => (draft ? setDraft(null) : onCancel?.())}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, color: 'var(--text-muted)', fontFamily: 'inherit',
            }}
          >
            {draft ? '← Start over' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}

function StepButton({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 24, height: 24, lineHeight: 1,
        background: 'transparent', border: '1px solid var(--line)',
        borderRadius: 6, cursor: 'pointer',
        color: 'var(--text-muted)', fontFamily: 'inherit', fontSize: 12,
      }}
    >
      {label}
    </button>
  )
}
