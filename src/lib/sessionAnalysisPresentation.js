// Turns a SessionAnalysisV1 conclusion/next-action code into the one sentence
// a person reads. This is the ONLY place prose is generated for the session
// report — sessionAnalysis.js stays code+evidence so it can be unit-tested
// without locking down wording, and both the post-session screen and the
// history detail view render through these same functions so they can never
// drift apart.

// Durations are rounded to whole seconds before splitting into minutes and
// seconds — a fractional accumulator otherwise renders as "12m 3.0000001s".
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`
}

export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(seconds || 0))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`
}

// Energy colours the SENTENCE, never the number — see sessionAnalysis.js and
// the CLAUDE.md invariant this whole module respects: energy is context, not
// a threshold. Ported verbatim from the old EndScreen.jsx.
export function energyInterpretation(energyLevel, focusPct) {
  if (!energyLevel || focusPct == null) return null
  if (energyLevel === 'tired' && focusPct >= 60) return 'You started tired and still held 60%+ focused time — the same number is worth more from that start.'
  if (energyLevel === 'fresh' && focusPct < 60) return 'You started fresh, so the friction likely came from the work or the environment rather than from energy.'
  return null
}

/** { headline, note } for the Session Read section — one plain conclusion plus
 *  its strongest supporting note. Returns null only when there is no
 *  conclusion at all (status !== 'ready'). */
export function describeConclusion(conclusion, facts) {
  if (!conclusion) return null
  const goal = facts?.intent?.goal || ''
  const targetText = goal ? `the stated target (${goal})` : 'the stated target'
  const tired = facts?.energyLevel === 'tired'

  switch (conclusion.code) {
    case 'NOT_MEASURED':
      return {
        headline: 'Attention was not measured for this session.',
        note: 'The read below reflects what you reported, independent of the camera.',
      }
    case 'SCORING_VERSION_INCOMPATIBLE':
      // Deliberately not "older": the native V2 ruler is newer, just measured
      // differently, and is held out of comparison until it is promoted.
      return {
        headline: 'This session was measured with a different scoring version, so its attention read is not compared here.',
        note: 'The read below still reflects what you reported.',
      }
    case 'HIGH_FOCUS_GOAL_MISSED':
      return {
        headline: `High focus, goal missed: ${targetText} may have been too large or mismatched for this block.`,
        note: 'Your attention was available; the constraint was probably task size, dependencies, or choosing the wrong work for the available session.',
      }
    case 'HIGH_FOCUS_PARTIAL':
      return {
        headline: `Strong focus, partial output: you made real progress, but ${targetText} needed more scope control.`,
        note: 'This usually points to an ambitious target rather than a failed session.',
      }
    case 'HIGH_FOCUS_GOAL_MET':
      return {
        headline: `Focus and output matched: you achieved ${targetText} with a strong attention pattern.`,
        note: tired
          ? 'That is especially useful data: tired energy still supported meaningful output under this setup.'
          : 'This is the cleanest signal that the task, duration, and workspace matched well.',
      }
    case 'LOW_FOCUS_GOAL_MET':
      return {
        headline: `Low focus, goal reached: ${targetText} may not require deep focus.`,
        note: 'The output landed even though attention was uneven, so this task type may belong in lighter-energy blocks.',
      }
    case 'LOW_FOCUS_GOAL_MISSED':
      return {
        headline: `Low focus, goal missed: energy, environment, or task clarity likely blocked ${targetText}.`,
        note: tired
          ? 'Because you started tired, this is a signal to reduce scope before judging the session harshly.'
          : 'The focus pattern and outcome point in the same direction: the session never got enough traction.',
      }
    case 'LOW_FOCUS_PARTIAL':
      return {
        headline: 'Uneven focus, partial output: the task moved, but the session carried friction.',
        note: tired
          ? 'For tired energy, partial output with uneven focus still counts as useful progress.'
          : 'The outcome was not a clean miss, but the focus pattern was costly.',
      }
    case 'MIXED_FOCUS_GOAL_MET':
      return {
        headline: `Goal reached with moderate focus: ${targetText} fit the session well enough.`,
        note: 'The result matters; the focus pattern suggests there is still room to make similar work feel cleaner.',
      }
    case 'MIXED_FOCUS_PARTIAL':
      return {
        headline: `Partly reached: ${targetText} moved forward, but not cleanly enough to call complete.`,
        note: 'This is useful calibration between intention and actual output.',
      }
    case 'MIXED_FOCUS_GOAL_MISSED':
      return {
        headline: `Goal not reached: ${targetText} did not match this session's conditions.`,
        note: 'Use the gap between intention and output to adjust scope, not just effort.',
      }
    default:
      return null
  }
}

/** One sentence for the single next-action recommendation. */
export function describeNextAction(nextAction) {
  if (!nextAction) return null
  const { start, end } = nextAction.evidence || {}

  switch (nextAction.code) {
    case 'SPLIT_SCOPE_SMALLER': return 'Next time, split the output into a smaller deliverable before starting.'
    case 'DEFINE_THINNER_FINISH_LINE': return 'Keep the same setup and define a thinner finish line for the next block.'
    case 'REUSE_SETUP': return 'Reuse this duration and setup for similar work.'
    case 'RESERVE_FOR_LIGHT_ENERGY': return 'Reserve fresh sessions for work that truly needs sustained attention.'
    case 'SHORTEN_SCOPE_AND_FIRST_ACTION': return 'Use a shorter duration and one concrete first action next time.'
    case 'TRY_SMALLER_TARGET_LOWER_INTERRUPTION': return 'Try a smaller target or a lower-interruption environment for the next attempt.'
    case 'REMOVE_LARGEST_DRIFT_SOURCE': return 'Keep the output size, then remove the largest drift source next time.'
    case 'MAKE_CRITERION_SMALLER_AND_OBSERVABLE': return 'Make the next success criterion observable and smaller.'
    case 'RESTART_SMALLER_OUTPUT_OR_ENVIRONMENT': return 'Restart with a smaller output or change the environment before trying again.'
    case 'RUN_LONGER_NEXT_TIME': return 'Run at least 5 minutes next time; the phase read is too short to tune behavior confidently.'
    case 'TIGHTEN_TASK_OR_APP_LIST': return 'Tighten the task wording or focus-app list before starting; the largest leak was app/site drift away from the stated aim.'
    case 'START_WITH_SMALLER_FIRST_ACTION': return 'Start with a smaller first action. The session spent too long arriving and did not build a stable ramp.'
    case 'TREAT_FIRST_DRIFT_CUE_AS_INTERVENTION': return 'Treat the first drift-risk cue as the intervention point: close the detour, straighten posture, or name the next action before a full alert is needed.'
    case 'REPEAT_SETUP': return 'Repeat this setup. Lock-in held without much fade, so keep the same duration and workspace rules.'
    case 'END_SOONER_AFTER_LOCKIN': return 'End or break sooner after lock-in drops. The useful block happened, then the tail started costing focus.'
    case 'USE_DELIBERATE_RECOVERY_MINUTE': return 'After an alert, use one deliberate recovery minute before pushing on; repeated recovery time suggests the session restarted too noisily.'
    case 'REMOVE_DISTRACTION_APP': return 'Add the repeated off-goal app/site to blockers or narrow allowed apps for this task type.'
    case 'MOVE_PHONE_AWAY': return 'Move the phone out of reach before starting; phone checks were strong enough to break the session state.'
    case 'ADDRESS_FATIGUE_SIGNALS': return 'Use a shorter session or take a real break first; fatigue signals drove the interruptions.'
    case 'WATCH_SPECIFIC_TIMESTAMP_RANGE': return `Watch the ${fmtClock(start)}-${fmtClock(end)} zone next time; attention dipped there without a clear app/site cause.`
    case 'KEEP_GENTLE_REMINDERS_ON': return 'Keep gentle reminders on. The session recovered through light nudges without escalating into drift-risk windows.'
    case 'KEEP_STRUCTURE_NO_DOMINANT_ISSUE': return 'Keep the same structure next time; no single phase, alert reason, or alignment leak dominated the session.'
    default: return null
  }
}
