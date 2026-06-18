# Eudaimonia — Focus Tracker

A minimal focus-session tracker that uses webcam-based attention detection (MediaPipe FaceMesh) to measure how focused you are during a work session.

## What it does

1. **Home screen** — user sets task name, duration (15/30/60/90 min), and monitor layout
2. **Session screen** — countdown timer + live FaceMesh analysis via webcam
3. **End screen** — session stats (focus %, longest streak, alerts, timeline bar)

The attention engine tracks:
- **Blink rate** (via Eye Aspect Ratio) — too few or too many blinks signals distraction
- **PERCLOS** — % of time eyes are 80%+ closed over a 60-s window
- **Head pitch** — head tilted down for >10 s = penalty
- **Head yaw** — head turned left/right for >5 s = penalty (thresholds raised for monitors in that direction)

When focus score drops below 40 for >90 s (or >120 s with extra monitors), a full-screen overlay + audio alert fires.

## Tech stack

- **React 18** + **Vite**
- **MediaPipe FaceMesh** loaded via CDN (`@mediapipe/face_mesh@0.4`) in `index.html`
- No backend — all state is in-memory per session; monitor count/positions persisted in `localStorage`

## Dev commands

```bash
npm install
npm run dev      # localhost:5173
npm run build    # output to dist/
npm run preview  # preview built dist/
```

## Project structure

```
src/
  App.jsx                 # Screen router + shared state (task, duration, monitors)
  components/
    HomeScreen.jsx        # Setup form (task, duration, monitor layout)
    SessionScreen.jsx     # FaceMesh loop, scoring, alert logic, countdown
    EndScreen.jsx         # Stats display
  App.css                 # All styles
index.html                # Loads MediaPipe + Camera via CDN scripts
```

## Key conventions

- No TypeScript — plain JSX throughout
- All attention logic lives in `SessionScreen.jsx`; keep it self-contained
- Scoring constants at the top of `SessionScreen.jsx` (EAR thresholds, window sizes, etc.)
- Monitor positions affect yaw thresholds via `computeThresholds()` — left/right monitors get 55° threshold instead of 30°
- `useRef` for all per-frame state to avoid stale closures in the MediaPipe callback
- Session stats accumulate in refs, only passed to `onEnd()` at session close
- No external state management — keep it simple

## Critical invariants — read before touching SessionScreen.jsx

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
   actually implement (e.g. `earlyMicrosleepMs = eyesClosedMs` was meant to
   be a separate earlier-threshold signal but was identical to the existing
   variable — the guard condition was added later as a fix). If a constant
   like `EARLY_MICROSLEEP_MS` is meant to gate a different condition than
   an existing threshold, the variable computing it must actually encode
   that condition, not just rename an existing one.

4. **Ramp/sustained-state refs must reset on hard state transitions.**
   `sustainedGoodMsRef` (focus ramp) and similar accumulators must be
   zeroed when the underlying state hard-resets — e.g. face fully absent
   (`faceAbsentMs >= FACE_ABSENT_HOLD_MS`). Otherwise an accumulated bonus
   leaks into a score that should be 0.

5. **Before changing a threshold or constant, `git log -S"<constant name>"`
   first.** If it was already tuned with a science citation in a comment,
   understand why before changing it again — don't silently revert a
   previous fix because the current task doesn't need to know about it.

6. **Self-check after editing this file:** scan every line you just
   changed for inversion bugs — `/` vs `*`, `<` vs `>`, `&&` vs `||` — and
   confirm the code's actual behavior matches what the comment next to it
   claims. Most regressions here were a one-character logic inversion that
   still "looked right" at a glance.

## GitHub

https://github.com/clemenssteinbrennercrypto-prog/eudonomia
