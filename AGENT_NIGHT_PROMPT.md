# Night Agent — Deep Research & Iterative Eye Tracker Improvement

## Your mission

You are doing autonomous overnight work on **Eudaimonia**, a browser-based focus tracker.
Your job: research the science of attention and eye tracking deeply, then iteratively improve
`src/components/SessionScreen.jsx` based on what you find.

**GitHub:** https://github.com/clemenssteinbrennercrypto-prog/eudonomia  
**Stack:** React 18 + Vite, MediaPipe FaceMesh (CDN), no backend, no TypeScript.  
**Main file:** `src/components/SessionScreen.jsx` — all detection + scoring logic lives here.

---

## Current system (as of today)

### Constants at top of SessionScreen.jsx:
```js
EAR_BLINK           = 0.20       // eye aspect ratio: blink threshold (overridden by personal baseline)
EAR_HEAVY           = 0.15       // heavy-closure threshold
EAR_PROLONGED_CLOSE = 0.18       // held closed eye
PROLONGED_CLOSE_MS  = 1500
MAR_YAWN            = 0.55       // mouth aspect ratio yawn detection
YAWN_HOLD_MS        = 1500
BLINK_WIN_MS        = 20_000     // blink rate measurement window
PERCLOS_WIN_MS      = 60_000     // PERCLOS window (% time eyes 80%+ closed)
PITCH_NEUTRAL       = 0.50       // head pitch neutral ratio
PHONE_PITCH_THRESH  = 38°        // extreme downward = phone use
PHONE_HOLD_MS       = 4000
HEAD_DOWN_HOLD      = 10s        // hold time before penalty
HEAD_TURN_HOLD      = 5s
FACE_ABSENT_HOLD_MS = 4000
HEAD_DRIFT_WIN_MS   = 3000
HEAD_DRIFT_THRESH   = 0.035
ALERT_COOLDOWN_MS   = 60_000
```

### Scoring (as of today — just redesigned):
- Base score: **68** when face present (not 100)
- **Positive bonuses**: healthy blink rate 12–20/min (+7), stable head (+5), work-zone gaze pitch 3–15° down (+5)
- **Penalties**: PERCLOS, prolonged close, yaw/pitch thresholds, yawn, phone, face absent
- **Sustained-focus ramp**: +0 to +15 over 2 minutes of consecutive good signals
- Max score 100 only reachable after sustained authentic focus
- Personal EAR baseline: 20s calibration on session start

### Head pose detection:
- Yaw from nose/eye horizontal offset (left/right threshold 30–55° depending on monitor setup)
- Pitch from nose-to-chin / face-height ratio
- 3-frame deadzone to prevent spike penalties

---

## Your research loop — do this iteratively

**For each research topic below:**
1. Use WebSearch to find peer-reviewed studies or authoritative sources
2. Extract specific numbers/thresholds that are directly applicable
3. Decide: does the current implementation need to change?
4. If yes: edit `src/components/SessionScreen.jsx` with the improvement
5. Commit the change with a message explaining the scientific source
6. Move to the next topic

**Do at least 3–4 full iterations. More is better.**

---

## Research topics (start here, but go deeper if you find more)

### 1. Blink rate & cognitive load
Current: healthy range = 12–20/min, penalty if < 8 or > 30.  
Research questions:
- What does the literature say about blink rate during active reading vs passive watching?
- Does blink rate suppression (< 5/min) during intense focus actually indicate focus or strain?
- Is 12–20/min really the right "healthy" range for screen work? Some studies suggest 15–17.
- Should the bonus threshold be tighter? Should we detect blink suppression as a POSITIVE signal for deep focus rather than penalizing it?

### 2. PERCLOS — is 60s the right window?
Current: PERCLOS measured over 60s window, penalty if > 8% or > 15%.  
Research questions:
- Original PERCLOS research (Wierwille & Ellsworth 1994) used what window?
- Is 60s appropriate for office/study context vs driving?
- What PERCLOS % actually correlates with impaired cognitive performance?
- Should we have separate thresholds for first 5 min (warm-up) vs later in session?

### 3. Head pose thresholds
Current: yaw penalty at 30° (55° if monitor in that direction), pitch down penalty at 20°.  
Research questions:
- What is the normal range of head movement during natural reading/typing?
- Studies on "gaze anchoring" — how far does head actually move during focused work?
- Is 30° yaw realistic? Some people have wider natural working angles.
- Should small yaw (5–15°) be a POSITIVE signal (looking at a second monitor = working)?

### 4. Eye Aspect Ratio & fatigue
Current: personal baseline from 20s calibration, blink threshold = baseline × 0.72.  
Research questions:
- Is 72% of baseline the right blink threshold? Literature often uses different ratios.
- How does EAR change during fatigue sessions? Does it drift downward?
- Should the baseline be re-calibrated mid-session (drift compensation)?
- Prolonged partial closure (PERCLOS heavy) vs full blinks: different meanings?

### 5. Microsleep & attention lapses
Current: face absent > 4s triggers full penalty.  
Research questions:
- Microsleeps last 0.5–15 seconds. How should we distinguish a microsleep from looking away?
- Is 4s the right FACE_ABSENT threshold? Looking at a printed document could be 3-6s.
- Should brief absences (< 2s) be neutral rather than starting a decay?

### 6. Attention restoration & flow states
Current: no concept of "flow state" — just a sustained ramp.  
Research questions:
- Attention Restoration Theory: after a distraction, how long does it take to return to focus?
- Flow state indicators from eye tracking literature?
- Should recovery after a distraction be scored differently than sustained focus?
- Is the current 2-min ramp to 100 scientifically grounded? What does literature suggest?

### 7. Circadian rhythm & session timing
Current: scoring is identical at any time of day.  
Research questions:
- Does blink rate / PERCLOS vary by time of day?
- Should thresholds be relaxed for late-night sessions (users are naturally more drowsy)?
- Post-lunch dip: known attention drop ~1–3pm. Should the app account for this?

---

## Hard constraints — do NOT break these

- No backend, no external APIs called at runtime
- MediaPipe FaceMesh runs in browser — only the 468 landmarks are available
- All changes inside `src/components/SessionScreen.jsx` (constants + scoring logic)
- Keep the same output format: `onEnd({ focusScore, focusedSeconds, distractionEvents, ... })`
- Do not change the UI components (FocusRing, StatusDot, overlay) — only the detection logic
- Test that the file has no syntax errors after each change (you can grep for obvious issues)
- Commit after each meaningful improvement, with the scientific source in the commit message

---

## Also fix these known issues (do these first, quickly)

1. **Status threshold mismatch**: Session starts at score 68, but `focused` threshold is 70 → user starts in "distracted" (yellow). Fix: change the status thresholds to match new range:
   ```js
   // change from:
   focusScoreRef.current >= 70 ? 'focused' : focusScoreRef.current >= 40 ? 'distracted' : 'alert'
   // to:
   focusScoreRef.current >= 65 ? 'focused' : focusScoreRef.current >= 38 ? 'distracted' : 'alert'
   ```

2. **LegalModal placeholder data** in `src/components/LegalModal.jsx`:
   Replace all `[Vorname Nachname]` → `Clemens Steinbrenner`  
   Replace all `[Adresse]` → `Wien, Österreich`  
   Replace all `[email@example.com]` and `[Straße, PLZ Ort, Österreich]` → `clemenssteinbrenner.crypto@gmail.com`

3. **vercel.json** — create `vercel.json` in project root for SPA routing:
   ```json
   {
     "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
   }
   ```

---

## Output format

After each research iteration, commit with message format:
```
science: [topic] — [what changed] ([source])
```
Example: `science: PERCLOS window reduced to 45s (Wierwille & Ellsworth 1994)`

At the end, create `MORNING_REPORT.md` with:
- What you researched
- What you changed and why (with sources)
- What you couldn't verify / left unchanged
- Any open questions for the next session
