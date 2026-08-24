# Eudaimonia / Eudonomia — briefing for coding agents

Read this fully before your first edit. It exists so you start where the last
agent left off instead of relearning — including the things that were tried and
rejected, which are cheaper to read than to rediscover.

Several agents work on this repo (Claude via Claude Code, "Stony" via OpenClaw,
and you). Everyone pushes to `main`. Assume the working tree is behind: **`git
pull` before you start and before you push.**

---

## 1. What this is

A focus tracker with teeth. It is one native macOS product with two layers:

- **Embedded UI** (`src/`) — React 18 + Vite, plain JSX, no TypeScript. Bundled
  into the Tauri WebView; it is not a standalone browser product. Reads the
  webcam via MediaPipe FaceMesh and turns attention into a live focus score.
- **Native core** (`companion/src-tauri/`) — Tauri 2 + Rust. Hosts the UI,
  watches which app/site is frontmost, and **blocks** distracting apps and sites
  during a session. Rust and React communicate only through Tauri commands and
  events; there is no local HTTP service.

The differentiator is that last word. Every competitor measures. This one
intervenes. Keep that asymmetry in mind when weighing features.

**Who it is for:** Clemens, 18, Austria. Launching around September 2026,
starting civil service the same month, so he has roughly 10–15 h/week from then.
Optimise for things that survive low maintenance.

**Positioning claim that constrains engineering:** *nothing leaves your device.*
The camera feed, the activity log, window titles and file names never go
anywhere. There is exactly one deliberate exception, described in §5.

---

## 2. Run it

```bash
npm install
npm run dev        # isolated UI development only; native features unavailable
npm test           # vitest, 126 tests — must stay green
npm run build      # production bundle
```

Rust side:

```bash
cd companion/src-tauri
cargo test         # 26 tests
cargo check
```

Full native app (needs Rust + tauri-cli, ~2 min):

```bash
npm run build:companion
```

### Gotchas that have cost real time

- **The dev server port moves.** It picks the first free port from 5173 up. Check
  the actual output rather than assuming.
- **`npm run build` succeeding proves very little.** The bundler does not flag
  undefined identifiers, so a removed variable that is still referenced builds
  clean and throws at runtime. This has already shipped a crash once. After
  removing anything, grep for the name.
- **The DMG step of `build:companion` often fails** on a leftover mounted volume
  from the previous build. The `.app` itself is fine. Fix with
  `hdiutil detach /Volumes/dmg.* -force` and delete `bundle/macos/rw.*.dmg`.
- **Version scheme.** CI builds are `0.1.$(date -u +%y%m%d%H%M)`; `tauri.conf.json`
  is pinned at `0.1.2`. Any CI build therefore outranks any local one, and the
  auto-updater will replace a locally installed build within minutes. To install
  a local build for testing, set a date-based version first, then restore the
  file. Do not commit the bumped version.
- **`/Applications/Eudonomia.app` is what the user actually launches.** Building
  into `target/release/bundle` changes nothing for them until it is copied there.
- **Pushing to `main` never updates the installed app.** Two release channels
  exist and they do not meet. `companion-test.yml` builds every push to `main`
  and publishes to the `internal-test` tag; `companion-release.yml` fills
  `releases/latest` and fires only on a `release-v*` tag. A build made from the
  default `tauri.conf.json` asks `releases/latest` — which sat at v0.1.10 from
  July 2026 for weeks. So the user reported "I see no change" after a correct,
  green, pushed commit, twice. Building from `tauri.test.conf.json` instead
  points the updater at `internal-test`, so every push to `main` reaches the
  machine within minutes. **Before telling the user to look at something, check
  which channel their installed build asks and when that channel last moved.**

---

## 3. Map

```
src/
  App.jsx                    screen router + shared session state
  components/
    SessionScreen.jsx        2800 lines. Camera, scoring, alerts, blocking sync.
    HistoryDashboard.jsx     stats, weekly view, personal calibration
    EndScreen.jsx            post-session debrief
    HomeScreen.jsx           session setup form
    FocusAppsScreen.jsx      companion config, blocking, model provider switch
  lib/
    attention.js       (+test)  PURE scoring/gaze maths — the invariants live here
    sessionIntent.js   (+test)  activity classification, artifacts
    modelClient.js              the ONLY place that talks to a model (transport)
    intentContract.js  (+test)  goal → expectations, switchable model providers
    sessionVerdict.js  (+test)  did the work match the intention? (after a session)
    calibration.js     (+test)  what YOUR history says about how you work
    activityReceiver.js         consumes native activity commands/events
    nativeCompanion.js   (+test) the only React ↔ Rust IPC boundary
    storage.js                  localStorage
companion/src-tauri/src/
    activity.rs        frontmost app/tab via AppleScript, app hiding
    blocking.rs        website blocking via /etc/hosts + privileged helper
    native.rs          Tauri commands, events and shared native state
    output.rs          output evidence — did the work actually move
```

**`SessionScreen.jsx` is 2800 lines with ~125 pieces of state.** It is the known
weak point. Every cross-cutting bug so far came from subsystems interacting
inside it. Splitting it is planned for after launch; until then, prefer
extracting pure logic into `src/lib/` (with tests) over adding to it.

---

## 4. The invariants

These are real regressions, each of which recurred because a later agent did not
know it had already been fixed. **Check this list before and after touching
scoring or detection.**

1. **Circadian direction.** `getCircadianFactor()` returns < 1.0 during tired
   hours. Tired hours must make the alert fire SOONER:
   `alertDelayMs * circFactor` — multiply, never divide. Inverted and re-fixed
   more than once.
2. **Every penalty needs a hold time or debounce.** No exception. One bad frame
   must never subtract score. Follow the existing 3-frame-deadzone or
   `*_HOLD_MS` patterns.
3. **No dead-alias variables.** Do not add a variable that is just
   `= someExistingVar` with a comment describing a distinction it does not
   implement.
4. **Accumulators reset on hard transitions.** Ramp and streak refs must zero
   when the face is fully absent or the camera faults, or a stale bonus leaks
   into a score that should be zero.
5. **`git log -S"<constant>"` before changing a threshold.** Several carry
   research citations and were tuned deliberately.
6. **Self-check after editing.** Scan changed lines for `/` vs `*`, `<` vs `>`,
   `&&` vs `||`. Most regressions here were a one-character inversion that looked
   right.
7. **Yaw sign convention.** `yawSigned > 0` means the head turned to the user's
   LEFT — confirmed from live data and consistent with the head-turn counters.
   Code mapping yaw to a screen side must pair positive yaw with a LEFT screen.
   This was inverted once: "looking left" read as "productively facing the right
   monitor", which suppressed the penalty *and* paid a bonus for looking away.
   Separately, `irisH > 0` means eyes toward the user's RIGHT — the OPPOSITE
   convention. Scoring depends on that opposition. Do not "simplify" it without
   re-deriving from data.
8. **The score bands are named constants and must stay separated.**
   `FOCUSED_SCORE` (40) < `GOOD_STREAK_SCORE` (65) < `FLOW_SCORE` (72), all in
   `attention.js`. `FOCUSED_SCORE` decides `focusedSeconds`, which IS the
   reported focus percentage — history trends, calibration, the end screen and
   the CSV export are all derived from it. Removing the energy profile replaced
   all three with the literal `1`, so every second at score ≥ 1 counted as
   focused and the metric stopped separating a good session from a bad one.
   Nothing failed: no test touched them, and the downstream tests fabricate
   `focusedSeconds` from a percentage instead of measuring it. The band tests in
   `attention.test.js` now fail if any bar collapses — do not weaken them.
   Note the bands do NOT protect against a dead camera: 68 (the no-data default)
   clears `FOCUSED_SCORE`. That is what the frame heartbeat and `trackingFaulted`
   are for; the two guards are independent and both are load-bearing.
9. **Derived Focus Score history is versioned, never silently reinterpreted.**
   `focusMetric.js` summarizes the live signal without changing it. Its V1
   parameters are explicit product estimates, not research constants. Current
   sessions enter with the matching attention-scoring version. Pre-ledger
   sessions may enter only through the explicit `legacy_timeline_v1` migration,
   which requires their saved five-second score timeline plus exact phase-second
   totals and records that provenance; an old focus percentage alone is never
   enough. Legacy sessions without those raw measurements stay absent rather
   than being guessed. Review V1 after 30 valid measured days and create V2 for
   changed parameters instead of rewriting stored V1 days.

---

## 5. Design principles — the expensive ones

These were argued out and paid for. Violating them will get the change reverted.

**Refuse rather than guess.** `calibration.js` says nothing below 8 usable
sessions, compares no bucket below 3 samples, and calls no difference a pattern
below 12 points. A confident sentence from four sessions is a horoscope, and it
destroys trust faster than saying nothing. Most of its tests are about the
silence, not the speech.

**Never report what was not measured.** If the camera pipeline delivers no
frames, the score is not zero and not the default — it is absent
(`trackingFaulted`, `finalScore: null`). This app once counted every second as
focused when the camera was off, producing a fabricated ~100% session. Do not
reintroduce a default that can pass for a measurement.

**One ruler, every day.** Nothing may shift a scoring threshold based on
self-reported state. An energy dropdown that lowered the bar for "tired" was
removed for exactly this reason: it made Tuesday's 70 incomparable with
Monday's, and comparable history is the only durable asset here. Energy is
recorded and colours the *interpretation* — never the measurement.

**Metadata only, always.** `output.rs` reads sizes, mtimes, names and git counts.
It never opens a file, never reads content, never logs keystrokes. If a signal
cannot be had from `stat`, it is not gathered.

**Models propose; they never decide alone.** Anything a language model returns
passes through `normalizeContract` / `normalizePlan` first. Models return prose,
markdown fences, snake_case, invented enums, inverted ranges and 200-item lists.
None of that may reach the rest of the app. A model may also never set a
duration — session length comes from the user's measured history.

**The user's explicit rule outranks any inference.** Their own blocklist wins
over any model's opinion about their goal.

**Aggregate before a model sees a session.** `sessionVerdict.js`'s
`buildVerdictInput()` is where cost and privacy turn out to be the same
boundary. A raw session record is ~33,000 tokens and ~92% of that is the
per-second `timeline` — data a model cannot use and would be billed for.
Aggregating first brings it to ~1,200: a 27x cost difference, larger than the
gap between the cheapest and most expensive model. The fields dropped for cost
are exactly the ones carrying private content — window titles (`label`),
title-derived artifact names (`byArtifact`), the watched folder path (`root`),
changed file names (`changedNames`). What survives is app names, bare
hostnames, durations and counts. Two test blocks nail this down; both were
verified to fail when the leak is reintroduced. Do not enrich that payload
without reading them.

**A model that cannot judge says nothing.** `deriveVerdict()` returns null on
the `keywords` provider rather than a cheap verdict, because keyword matching
cannot weigh "40 minutes in Figma" against "write the intro chapter". Null is
also what an absent model, a thin session and a failed call return — the end
screen renders nothing in every case. An absent verdict costs the user nothing;
a fabricated one costs trust.

### The one thing that leaves the device

Goal understanding is **opt-in and off by default** (`keywords` provider). If the
user switches to `local` (Ollama) or `cloud` (Anthropic API), **only the goal
sentence they typed** is sent — never the activity log, window titles or file
names. A test asserts the prompt contains none of them. Keep it that way.

All three providers are async, return the identical shape, and **fall back to
`keywords`** on any failure. A model that is absent, slow or talking nonsense
degrades the result; it never breaks a session.

---

## 6. Already tried and rejected — do not rebuild

- **Projects / multi-session plans.** A full "plan a project → steps → next-up
  card → optimization phase" arc was built and reverted at the user's request
  (see the revert commit). Do not propose it again without him raising it.
- **Two design directions** (a stoic session screen, a cinematic landing page)
  were rejected outright. **Do not invent visual directions.** The current one —
  ultramarine, dark, one accent — was chosen by him explicitly.
- **Energy-adjusted scoring thresholds.** Removed on purpose; see §5.
- **B2B employee monitoring.** A legal dead end: EU AI Act Article 5(1)(f)
  prohibits emotion recognition in the workplace, and Austrian §96 ArbVG
  requires works-council consent. Stay consumer.
- **A camera pre-flight before MediaPipe.** Acquiring and releasing a stream just
  before MediaPipe reacquires it risks a `NotReadableError` race on real
  hardware. Reverted.

---

## 7. Testing and verification

79 JS tests, 19 Rust tests. Both must stay green.

Test the **refusals and the boundaries**, not just the happy path. The valuable
tests here assert that the code stays quiet on thin data, rejects malformed model
output, and survives records written before a field existed.

**A green build is not verification.** For anything with a runtime surface,
actually drive it: the app runs at `localhost:5173` and can be driven from the
browser console. Useful trick — a canvas `captureStream` stubbed into
`navigator.mediaDevices.getUserMedia` exercises the whole camera path without
hardware:

```js
navigator.mediaDevices.getUserMedia = async () => {
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 240
  const c = cv.getContext('2d')
  setInterval(() => { c.fillStyle = '#141c42'; c.fillRect(0, 0, 320, 240) }, 60)
  return cv.captureStream(15)
}
```

---

## 8. Working with Clemens

- **He wants blunt honesty**, including about business decisions. He has asked
  for it explicitly. Do not soften a real problem.
- **Show the smallest working thing early.** The rejected project feature was
  three layers deep before he saw it. He approved a *description*, which is not
  the same as approving the thing. Build one usable slice, show it, then
  continue.
- **Never guess at visual taste.** Ask for a reference or a concrete direction.
- **He writes German; the codebase and commits are English.** Replying in German
  is welcome.
- **Do not kill the running companion** without checking the native Protection
  screen for an inactive session and disabled app/website blocking first, and
  say so before you do.

### Commits

Explain *why*, not what — the diff already says what. Name the failure mode the
change prevents. Note anything a later agent would otherwise rediscover. End
with your own attribution trailer.

Do not push to `.github/workflows/` — that is Stony's area and tokens are
typically scoped to reject it.

---

## 9. Current state (August 2026)

Working and verified: ultramarine design across the app, motion layer with
`prefers-reduced-motion`, real 2D gaze tracking, camera fault detection and
sleep/wake recovery, bundled offline MediaPipe, artifact tracking, output
evidence in Rust, personal calibration, switchable goal-understanding providers.
CI runs the unit tests on every push to `main` (job `test-build`, step "Run unit
tests") — confirmed green 11 Aug 2026, so a red suite will be caught.

Open, in rough priority order:

1. **Real usage.** Calibration stays silent below 8 sessions and output evidence
   needs a nominated folder. Several features cannot be judged until they have
   data. This matters more than the next feature. As of 11 Aug 2026 the stored
   history holds ten sessions, none newer than 4 Aug — which is why a scoring
   regression sat unnoticed for five days.
2. **Impressum address.** `LegalModal.jsx` carries a `TODO(legal)`: § 5 ECG
   requires a geographic address (street, number, postcode) and "Wien,
   Österreich" is not one. Only Clemens can supply it. Launch blocker.
3. **Apple Developer Program** (€99/yr, individual — no company needed). Until
   then builds are ad-hoc signed and Gatekeeper warns on first launch. The
   signing pipeline is already written and waiting on six `APPLE_*` secrets.
4. **Splitting `SessionScreen.jsx`** — after launch, not before.
5. **Windows port** — architecturally feasible (the Rust is ~1600 lines and
   macOS-specific only at the edges; the hosts-file technique is identical). The
   hard part is reading browser URLs without AppleScript. Wait for demand.

Product weaknesses found 11 Aug 2026 and NOT yet addressed — these are
decisions for Clemens, not bugs to fix unasked:

- **The differentiator ships off.** A new user sees "0 focus apps · 0 blocked".
  Blocking is the one thing competitors lack, and it is empty by default, behind
  a config screen and an admin password. Most users will never see it work.
- **Nothing brings the user back.** There is no notification, reminder or
  scheduling anywhere in the codebase. A focus tracker without re-engagement is
  a one-week app.
