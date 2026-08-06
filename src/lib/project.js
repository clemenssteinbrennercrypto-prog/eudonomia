// A project — the thing a session belongs to.
//
// Until now the only object was a lone session: it began at nothing, asked for
// the same four fields, and knew nothing of the one before it. Nothing could
// plan, because there was nothing to plan across. A project is that missing
// object: a goal, an ordered set of steps, and a record of what actually
// happened to each.
//
// Two rules hold this together:
//
//  - The PLAN is a proposal, never a verdict. Steps are estimates and the user
//    may reorder, resize, skip or abandon them at any point. Nothing here
//    enforces anything.
//  - Step sizes come from MEASUREMENT, not from a model's guess. A step is one
//    session long, and how long a session actually holds is something the
//    user's own history knows (see calibration.js). A model that invents "90
//    minutes" for someone whose attention reliably goes at 45 is worse than no
//    plan at all.

/** A step nobody has sized, and no history to size it from. */
export const DEFAULT_STEP_MINUTES = 50

export const STEP_STATES = ['pending', 'done', 'skipped']

let idCounter = 0
function newId(prefix) {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`
}

export function makeStep(label, options) {
  // `= {}` only defaults undefined, so an explicit null would throw here — and
  // a plan arriving from a model or from storage can absolutely contain nulls.
  const { minutes = DEFAULT_STEP_MINUTES, note = '' } = options || {}
  return {
    id: newId('step'),
    label: String(label || '').trim().slice(0, 120),
    minutes: Math.max(10, Math.min(180, Math.round(minutes) || DEFAULT_STEP_MINUTES)),
    note: String(note || '').trim().slice(0, 200),
    state: 'pending',
    sessionIds: [],
    actualMinutes: 0,
  }
}

export function createProject({ title, steps = [], source = 'manual', kind = 'general' } = {}) {
  const clean = String(title || '').trim().slice(0, 160)
  if (!clean) return null
  return {
    id: newId('proj'),
    title: clean,
    kind,
    source,                    // which engine proposed the plan
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archivedAt: null,
    steps: steps
      .map(s => (typeof s === 'string' ? makeStep(s) : makeStep(s?.label, s)))
      .filter(s => s.label),
  }
}

/** The step to work on now — the first that is neither done nor skipped. */
export function nextStep(project) {
  if (!project?.steps?.length) return null
  return project.steps.find(s => s.state === 'pending') || null
}

export function projectProgress(project) {
  const steps = project?.steps || []
  const total = steps.length
  const done = steps.filter(s => s.state === 'done').length
  const skipped = steps.filter(s => s.state === 'skipped').length
  const remaining = steps.filter(s => s.state === 'pending')
  return {
    total,
    done,
    skipped,
    remaining: remaining.length,
    pct: total ? Math.round((done / total) * 100) : 0,
    minutesRemaining: remaining.reduce((sum, s) => sum + s.minutes, 0),
    complete: total > 0 && remaining.length === 0,
  }
}

function touch(project, steps) {
  return { ...project, steps, updatedAt: Date.now() }
}

/** Record that a session worked on a step. `done` closes it; otherwise the step
 *  stays open, because one session is an estimate and not always enough. */
export function recordSessionOnStep(project, stepId, { sessionId, minutes = 0, done = true } = {}) {
  if (!project?.steps) return project
  const steps = project.steps.map(s => {
    if (s.id !== stepId) return s
    return {
      ...s,
      state: done ? 'done' : s.state,
      actualMinutes: s.actualMinutes + Math.max(0, Math.round(minutes)),
      sessionIds: sessionId && !s.sessionIds.includes(sessionId)
        ? [...s.sessionIds, sessionId]
        : s.sessionIds,
    }
  })
  return touch(project, steps)
}

export function setStepState(project, stepId, state) {
  if (!STEP_STATES.includes(state)) return project
  return touch(project, project.steps.map(s => (s.id === stepId ? { ...s, state } : s)))
}

export function addStep(project, label, opts) {
  const step = makeStep(label, opts)
  return step.label ? touch(project, [...project.steps, step]) : project
}

export function removeStep(project, stepId) {
  return touch(project, project.steps.filter(s => s.id !== stepId))
}

/** Move a step up or down. Plans are proposals; reordering must be trivial. */
export function moveStep(project, stepId, delta) {
  const steps = [...(project?.steps || [])]
  const i = steps.findIndex(s => s.id === stepId)
  const j = i + delta
  if (i === -1 || j < 0 || j >= steps.length) return project
  ;[steps[i], steps[j]] = [steps[j], steps[i]]
  return touch(project, steps)
}

/**
 * Resize every open step to the length that actually works for this person.
 * Called after calibration learns something, and again during the optimization
 * phase. Completed steps are left alone — they are history, not plan.
 */
export function resizeOpenSteps(project, minutes) {
  const m = Math.max(10, Math.min(180, Math.round(minutes) || DEFAULT_STEP_MINUTES))
  return touch(
    project,
    project.steps.map(s => (s.state === 'pending' ? { ...s, minutes: m } : s))
  )
}

/**
 * What the measured pace says about what is left.
 *
 * `paceRatio` is how much of an estimated step a session actually completes: 1
 * means the estimates hold, 0.5 means everything takes twice as long. Returns
 * null rather than a guess when there is not enough finished work to tell —
 * the same refusal rule as calibration.
 */
export function estimateRemaining(project, { minSamples = 2 } = {}) {
  const finished = (project?.steps || []).filter(s => s.state === 'done' && s.actualMinutes > 0)
  if (finished.length < minSamples) return null

  const planned = finished.reduce((sum, s) => sum + s.minutes, 0)
  const actual = finished.reduce((sum, s) => sum + s.actualMinutes, 0)
  if (!planned || !actual) return null

  const paceRatio = planned / actual              // < 1 means slower than planned
  const progress = projectProgress(project)
  const naiveMinutes = progress.minutesRemaining
  const adjustedMinutes = Math.round(naiveMinutes / paceRatio)

  return {
    samples: finished.length,
    paceRatio,
    plannedMinutes: naiveMinutes,
    adjustedMinutes,
    // Only worth surfacing when the gap is big enough to change a decision.
    materiallyOff: Math.abs(adjustedMinutes - naiveMinutes) >= Math.max(20, naiveMinutes * 0.25),
  }
}

// ── The optimization phase ───────────────────────────────────────────────────
// After a session, what the measurement says about the plan that produced it.
//
// Everything here is a PROPOSAL with a visible reason. Nothing is applied
// automatically, and nothing is proposed without evidence: a plan that quietly
// rewrote itself would be worse than one that was simply wrong, because you
// could no longer tell which of your own decisions still stood.

/** Below this the difference is not worth interrupting anyone about. */
const RESIZE_THRESHOLD_MIN = 15

export function proposeRevisions(project, {
  sessionMinutes = null,   // what history says a session should be
  lastStepId = null,       // the step the session just worked on
  lastOutcome = null,      // the user's own verdict: 'yes' | 'partly' | 'no'
  lastFocusPct = null,
} = {}) {
  if (!project?.steps?.length) return []
  const out = []
  const progress = projectProgress(project)
  const lastStep = lastStepId ? project.steps.find(s => s.id === lastStepId) : null

  // 1. The only ground truth in the system: the person said it isn't done.
  //    A step closed by the timer rather than by finishing should reopen.
  if (lastStep && lastStep.state === 'done' && (lastOutcome === 'no' || lastOutcome === 'partly')) {
    out.push({
      id: 'reopen',
      kind: 'reopen_step',
      stepId: lastStep.id,
      summary: lastOutcome === 'no'
        ? `You said "${lastStep.label}" isn't done. Reopen it?`
        : `"${lastStep.label}" is partly there. Keep it open for another session?`,
      detail: 'The session ended because the timer ended, not because the work did.',
    })
  }

  // 2. The plan is sized wrong for how this person actually works.
  const open = project.steps.filter(s => s.state === 'pending')
  if (sessionMinutes && open.length) {
    const current = open[0].minutes
    if (Math.abs(sessionMinutes - current) >= RESIZE_THRESHOLD_MIN) {
      out.push({
        id: 'resize',
        kind: 'resize_steps',
        minutes: sessionMinutes,
        summary: `Resize the remaining ${open.length} ${open.length === 1 ? 'step' : 'steps'} from ${current} to ${sessionMinutes} minutes?`,
        detail: `${sessionMinutes} minutes is where your focus measurably holds.`,
      })
    }
  }

  // 3. The estimates are not surviving contact. Stated, never silently applied —
  //    the honest response to "this is slower than planned" is a decision, not
  //    an invented extra step.
  const pace = estimateRemaining(project)
  if (pace?.materiallyOff && progress.remaining > 0) {
    const slower = pace.paceRatio < 1
    out.push({
      id: 'pace',
      kind: 'pace_estimate',
      summary: slower
        ? `At your measured pace the rest is about ${pace.adjustedMinutes} minutes, not ${pace.plannedMinutes}.`
        : `You are running ahead — the rest looks more like ${pace.adjustedMinutes} minutes than ${pace.plannedMinutes}.`,
      detail: `Based on ${pace.samples} finished ${pace.samples === 1 ? 'step' : 'steps'}.`,
      informational: true,
    })
  }

  // 4. Focused the whole way and still not done: the step was too big, not the
  //    person too slow. Worth separating, because the fix is different.
  if (lastStep && lastOutcome === 'no' && lastFocusPct != null && lastFocusPct >= 70) {
    out.push({
      id: 'oversized',
      kind: 'step_too_big',
      summary: `You held ${lastFocusPct}% focus and still didn't finish — that step is too big for one sitting.`,
      detail: 'Splitting it will do more than trying harder.',
      informational: true,
    })
  }

  return out
}

/** Apply one proposal. Unknown or informational ones change nothing. */
export function applyRevision(project, revision) {
  if (!project || !revision) return project
  switch (revision.kind) {
    case 'reopen_step':
      return setStepState(project, revision.stepId, 'pending')
    case 'resize_steps':
      return resizeOpenSteps(project, revision.minutes)
    default:
      return project
  }
}
