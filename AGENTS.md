# Eudaimonia — Dev Agent Rules

This file mirrors the "Critical invariants" section of `CLAUDE.md`, kept
as a separate file in case your agent runtime looks for `AGENTS.md`
specifically instead of (or in addition to) `CLAUDE.md`.

If your runtime doesn't auto-load either file from the repo root, copy
this content into whatever persistent instruction file it does load
(e.g. its own `MEMORY.md`).

## Critical invariants — read before touching src/components/SessionScreen.jsx

These are real regressions found during review (not hypothetical). Each one
recurred at least once because a later session didn't know it had already
been fixed. Check this list before and after editing scoring/detection logic.

1. **Circadian factor direction.** `getCircadianFactor()` returns a value
   < 1.0 during tired hours (night, post-lunch dip). Tired hours must make
   the alert fire SOONER, not later. That means:
   `adjustedAlertMs = alertDelayMs * circFactor` — multiply, never divide.
   (This exact line was fixed, then reverted by a later refactor, then
   fixed again. If you touch this line, re-read this paragraph first.)

2. **Every penalty needs a hold-time/debounce — no exceptions.** Every
   existing penalty in this file (phone, head-down, head-turn, yawn) only
   fires after a sustained condition: either a `*_HOLD_MS` ref+timestamp
   pattern, or the 3-frame deadzone pattern (`headDownFramesRef`,
   `headTurnLeftFramesRef`, etc.). If you add a new penalty path —
   especially anything based on per-frame classification (gaze direction,
   object proximity, pose) — it MUST use the same pattern before it can
   subtract score. A single bad frame should never trigger a severe (-25
   or worse) penalty. Grep for `HOLD_MS` and `FramesRef` to see the
   existing examples before adding a new one.

3. **No dead-alias variables.** Don't create a new variable that's just
   `= someExistingVar` with a comment explaining a distinction it doesn't
   actually implement. If a constant is meant to gate a different
   condition than an existing threshold, the variable computing it must
   actually encode that condition, not just rename an existing one.

4. **Ramp/sustained-state refs must reset on hard state transitions.**
   Accumulator refs like focus ramps must be zeroed when the underlying
   state hard-resets — e.g. face fully absent. Otherwise an accumulated
   bonus leaks into a score that should be 0.

5. **Before changing a threshold or constant, `git log -S"<constant name>"`
   first.** If it was already tuned with a science citation in a comment,
   understand why before changing it again — don't silently revert a
   previous fix because the current task doesn't need to know about it.

6. **Self-check after editing this file:** scan every line you just
   changed for inversion bugs — `/` vs `*`, `<` vs `>`, `&&` vs `||` — and
   confirm the code's actual behavior matches what the comment next to it
   claims. Most regressions here were a one-character logic inversion that
   still "looked right" at a glance.
