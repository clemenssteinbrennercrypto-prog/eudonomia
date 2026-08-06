import { describe, it, expect } from 'vitest'
import {
  DEFAULT_STEP_MINUTES,
  addStep,
  applyRevision,
  createProject,
  estimateRemaining,
  makeStep,
  moveStep,
  nextStep,
  projectProgress,
  proposeRevisions,
  recordSessionOnStep,
  removeStep,
  resizeOpenSteps,
  setStepState,
} from './project'

const plan = ['Outline the intro', 'Draft 400 words', 'Revise and cite']
const proj = (steps = plan) => createProject({ title: 'Thesis intro chapter', steps })

describe('creating a project', () => {
  it('keeps the goal and the ordered steps', () => {
    const p = proj()
    expect(p.title).toBe('Thesis intro chapter')
    expect(p.steps.map(s => s.label)).toEqual(plan)
    expect(p.steps.every(s => s.state === 'pending')).toBe(true)
  })

  it('refuses a project with no title rather than creating a nameless one', () => {
    expect(createProject({ title: '' })).toBeNull()
    expect(createProject({ title: '   ' })).toBeNull()
    expect(createProject({})).toBeNull()
  })

  it('drops empty steps instead of carrying blanks into the plan', () => {
    const p = createProject({ title: 'x', steps: ['real', '', '   ', null] })
    expect(p.steps).toHaveLength(1)
  })

  it('gives every step a distinct id', () => {
    const ids = proj().steps.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('clamps absurd step lengths rather than trusting them', () => {
    expect(makeStep('x', { minutes: 100000 }).minutes).toBe(180)
    expect(makeStep('x', { minutes: 1 }).minutes).toBe(10)
    expect(makeStep('x', { minutes: NaN }).minutes).toBe(DEFAULT_STEP_MINUTES)
  })
})

describe('what to do next', () => {
  it('is the first step that is neither done nor skipped', () => {
    let p = proj()
    expect(nextStep(p).label).toBe('Outline the intro')

    p = setStepState(p, p.steps[0].id, 'done')
    expect(nextStep(p).label).toBe('Draft 400 words')

    p = setStepState(p, p.steps[1].id, 'skipped')
    expect(nextStep(p).label).toBe('Revise and cite')
  })

  it('is null once nothing is left, rather than looping', () => {
    let p = proj()
    for (const s of p.steps) p = setStepState(p, s.id, 'done')
    expect(nextStep(p)).toBeNull()
    expect(projectProgress(p).complete).toBe(true)
  })

  it('is null for an empty or malformed project', () => {
    expect(nextStep(null)).toBeNull()
    expect(nextStep({})).toBeNull()
    expect(nextStep(createProject({ title: 'x' }))).toBeNull()
  })
})

describe('progress', () => {
  it('counts done, skipped and remaining separately', () => {
    let p = proj()
    p = setStepState(p, p.steps[0].id, 'done')
    p = setStepState(p, p.steps[1].id, 'skipped')

    const prog = projectProgress(p)
    expect(prog).toMatchObject({ total: 3, done: 1, skipped: 1, remaining: 1 })
    // A skipped step is not progress toward the goal.
    expect(prog.pct).toBe(33)
  })

  it('sums only the time still ahead', () => {
    let p = createProject({ title: 'x', steps: [{ label: 'a', minutes: 50 }, { label: 'b', minutes: 30 }] })
    expect(projectProgress(p).minutesRemaining).toBe(80)
    p = setStepState(p, p.steps[0].id, 'done')
    expect(projectProgress(p).minutesRemaining).toBe(30)
  })
})

describe('sessions attach to steps', () => {
  it('records the session and closes the step', () => {
    let p = proj()
    const id = p.steps[0].id
    p = recordSessionOnStep(p, id, { sessionId: 's1', minutes: 47 })
    expect(p.steps[0]).toMatchObject({ state: 'done', actualMinutes: 47, sessionIds: ['s1'] })
  })

  it('lets a step stay open across several sessions', () => {
    let p = proj()
    const id = p.steps[0].id
    p = recordSessionOnStep(p, id, { sessionId: 's1', minutes: 50, done: false })
    p = recordSessionOnStep(p, id, { sessionId: 's2', minutes: 40, done: true })
    expect(p.steps[0].actualMinutes).toBe(90)
    expect(p.steps[0].sessionIds).toEqual(['s1', 's2'])
    expect(p.steps[0].state).toBe('done')
  })

  it('does not record the same session twice', () => {
    let p = proj()
    const id = p.steps[0].id
    p = recordSessionOnStep(p, id, { sessionId: 's1', minutes: 20, done: false })
    p = recordSessionOnStep(p, id, { sessionId: 's1', minutes: 20, done: false })
    expect(p.steps[0].sessionIds).toEqual(['s1'])
  })
})

// A plan is a proposal, not a verdict — editing it must be trivial.
describe('the plan is editable', () => {
  it('reorders steps', () => {
    let p = proj()
    p = moveStep(p, p.steps[2].id, -1)
    expect(p.steps.map(s => s.label)).toEqual(['Outline the intro', 'Revise and cite', 'Draft 400 words'])
  })

  it('ignores a move off either end instead of throwing', () => {
    const p = proj()
    expect(moveStep(p, p.steps[0].id, -1).steps.map(s => s.label)).toEqual(plan)
    expect(moveStep(p, p.steps[2].id, 1).steps.map(s => s.label)).toEqual(plan)
  })

  it('adds and removes steps', () => {
    let p = proj()
    p = addStep(p, 'Proofread')
    expect(p.steps).toHaveLength(4)
    p = removeStep(p, p.steps[0].id)
    expect(p.steps.map(s => s.label)).toEqual(['Draft 400 words', 'Revise and cite', 'Proofread'])
  })
})

// Step size comes from measurement, never from a model's guess.
describe('resizing to the length that actually works', () => {
  it('resizes only steps still ahead — finished ones are history', () => {
    let p = proj()
    p = recordSessionOnStep(p, p.steps[0].id, { sessionId: 's1', minutes: 50 })
    p = resizeOpenSteps(p, 25)
    expect(p.steps[0].minutes).toBe(DEFAULT_STEP_MINUTES)
    expect(p.steps[1].minutes).toBe(25)
    expect(p.steps[2].minutes).toBe(25)
  })
})

// The seed of the optimization phase: what the measured pace says about what
// is left. It must refuse rather than guess.
describe('estimating what is left', () => {
  it('says nothing from a single finished step', () => {
    let p = proj()
    p = recordSessionOnStep(p, p.steps[0].id, { sessionId: 's1', minutes: 100 })
    expect(estimateRemaining(p)).toBeNull()
  })

  it('notices when everything takes about twice as long as planned', () => {
    let p = createProject({
      title: 'x',
      steps: [{ label: 'a', minutes: 50 }, { label: 'b', minutes: 50 }, { label: 'c', minutes: 50 }],
    })
    p = recordSessionOnStep(p, p.steps[0].id, { sessionId: 's1', minutes: 100 })
    p = recordSessionOnStep(p, p.steps[1].id, { sessionId: 's2', minutes: 100 })

    const e = estimateRemaining(p)
    expect(e.samples).toBe(2)
    expect(e.paceRatio).toBeCloseTo(0.5, 2)
    expect(e.plannedMinutes).toBe(50)
    expect(e.adjustedMinutes).toBe(100)
    expect(e.materiallyOff).toBe(true)
  })

  it('stays quiet when the estimates are holding', () => {
    let p = createProject({
      title: 'x',
      steps: [{ label: 'a', minutes: 50 }, { label: 'b', minutes: 50 }, { label: 'c', minutes: 50 }],
    })
    p = recordSessionOnStep(p, p.steps[0].id, { sessionId: 's1', minutes: 52 })
    p = recordSessionOnStep(p, p.steps[1].id, { sessionId: 's2', minutes: 48 })
    expect(estimateRemaining(p).materiallyOff).toBe(false)
  })

  it('never divides by zero on a step recorded with no time', () => {
    let p = proj()
    p = recordSessionOnStep(p, p.steps[0].id, { sessionId: 's1', minutes: 0 })
    p = recordSessionOnStep(p, p.steps[1].id, { sessionId: 's2', minutes: 0 })
    expect(() => estimateRemaining(p)).not.toThrow()
    expect(estimateRemaining(p)).toBeNull()
  })
})

// ── The optimization phase ───────────────────────────────────────────────────
// Proposals only, always with a reason. A plan that rewrote itself quietly
// would be worse than one that was simply wrong.
describe('proposing revisions after a session', () => {
  const built = () => createProject({
    title: 'x',
    steps: [{ label: 'a', minutes: 50 }, { label: 'b', minutes: 50 }, { label: 'c', minutes: 50 }],
  })

  it('proposes nothing when there is nothing to say', () => {
    const p = built()
    expect(proposeRevisions(p, { lastStepId: p.steps[0].id, lastOutcome: 'yes' })).toEqual([])
  })

  it('proposes reopening a step the person says is not done', () => {
    let p = built()
    const id = p.steps[0].id
    p = recordSessionOnStep(p, id, { sessionId: 's1', minutes: 50 })

    const r = proposeRevisions(p, { lastStepId: id, lastOutcome: 'no' })
    const reopen = r.find(x => x.kind === 'reopen_step')
    expect(reopen).toBeTruthy()

    const after = applyRevision(p, reopen)
    expect(after.steps[0].state).toBe('pending')
    expect(nextStep(after).id).toBe(id)
  })

  it('treats "partly" as reason to keep it open too', () => {
    let p = built()
    const id = p.steps[0].id
    p = recordSessionOnStep(p, id, { sessionId: 's1', minutes: 50 })
    expect(proposeRevisions(p, { lastStepId: id, lastOutcome: 'partly' })
      .some(x => x.kind === 'reopen_step')).toBe(true)
  })

  it('proposes resizing when the plan is sized wrong for this person', () => {
    const p = built()
    const r = proposeRevisions(p, { sessionMinutes: 25 })
    const resize = r.find(x => x.kind === 'resize_steps')
    expect(resize.minutes).toBe(25)

    const after = applyRevision(p, resize)
    expect(after.steps.every(s => s.minutes === 25)).toBe(true)
  })

  it('does not nag about a small difference', () => {
    expect(proposeRevisions(built(), { sessionMinutes: 55 })
      .some(x => x.kind === 'resize_steps')).toBe(false)
  })

  it('states the real cost when estimates are not surviving contact', () => {
    let p = built()
    p = recordSessionOnStep(p, p.steps[0].id, { sessionId: 's1', minutes: 100 })
    p = recordSessionOnStep(p, p.steps[1].id, { sessionId: 's2', minutes: 100 })

    const pace = proposeRevisions(p).find(x => x.kind === 'pace_estimate')
    expect(pace.summary).toContain('100')      // adjusted
    expect(pace.summary).toContain('50')       // planned
    expect(pace.informational).toBe(true)
  })

  it('never invents extra steps to "fix" a slow pace', () => {
    let p = built()
    p = recordSessionOnStep(p, p.steps[0].id, { sessionId: 's1', minutes: 100 })
    p = recordSessionOnStep(p, p.steps[1].id, { sessionId: 's2', minutes: 100 })
    const pace = proposeRevisions(p).find(x => x.kind === 'pace_estimate')
    expect(applyRevision(p, pace).steps).toHaveLength(3)
  })

  it('separates "step too big" from "you were distracted"', () => {
    let p = built()
    const id = p.steps[0].id
    p = recordSessionOnStep(p, id, { sessionId: 's1', minutes: 50 })

    const focused = proposeRevisions(p, { lastStepId: id, lastOutcome: 'no', lastFocusPct: 85 })
    expect(focused.some(x => x.kind === 'step_too_big')).toBe(true)

    const scattered = proposeRevisions(p, { lastStepId: id, lastOutcome: 'no', lastFocusPct: 30 })
    expect(scattered.some(x => x.kind === 'step_too_big')).toBe(false)
  })

  it('applies nothing for an informational or unknown proposal', () => {
    const p = built()
    expect(applyRevision(p, { kind: 'pace_estimate' })).toBe(p)
    expect(applyRevision(p, { kind: 'nonsense' })).toBe(p)
    expect(applyRevision(p, null)).toBe(p)
  })

  it('survives a malformed project without throwing', () => {
    expect(proposeRevisions(null, {})).toEqual([])
    expect(proposeRevisions({}, {})).toEqual([])
  })
})
