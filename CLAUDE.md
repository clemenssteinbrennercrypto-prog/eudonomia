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

## GitHub

https://github.com/clemenssteinbrennercrypto-prog/eudonomia
