// Shared label/color tables for the session report — used by MeasuredFacts,
// SessionDetails, CheckIn, and (via analytics/sessions/SessionDetailView) the
// history detail view. Kept in one place so the post-session screen and the
// reopened-from-history view can never disagree on what a code means.

export const DISTRACTION_LABELS = {
  phone: 'Phone check',
  yawn: 'Fatigue',
  away: 'Left camera',
  lookingup: 'Daydreaming',
  prolonged: 'Eyes closed',
  distraction_app: 'Distracting app',
  default: 'Distracted',
}

export const PHASE_LABELS = {
  arrival: 'Arrival',
  ramp: 'Ramp',
  lock_in: 'Lock-in',
  fade: 'Fade',
  recovery: 'Recovery',
  drift: 'Drift',
}

export const PHASE_COLORS = {
  arrival: '#5BC8FF',
  ramp: 'var(--good)',
  lock_in: '#B79CFF',
  fade: 'var(--warn)',
  recovery: '#fb7185',
  drift: 'var(--bad)',
}

export const ACTIVITY_KIND_LABELS = {
  blocked: 'Blocked',
  aligned: 'Aligned',
  supportive: 'Supportive',
  unclear: 'Unclear',
  off_goal: 'Off-goal',
  distraction: 'Distraction',
}

export const ACTIVITY_KIND_COLORS = {
  blocked: 'var(--bad)',
  aligned: 'var(--good)',
  supportive: '#14b8a6',
  unclear: 'var(--text-muted)',
  off_goal: 'var(--warn)',
  distraction: 'var(--warn)',
}

export const GOAL_OUTCOMES = [
  { value: 'yes', label: 'Yes', color: 'var(--good)' },
  { value: 'partly', label: 'Partly', color: 'var(--warn)' },
  { value: 'no', label: 'No', color: 'var(--bad)' },
]

export const ENERGY_LABELS = {
  fresh: 'Fresh',
  medium: 'Medium',
  tired: 'Tired',
}
