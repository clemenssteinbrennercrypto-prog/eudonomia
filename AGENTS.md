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
  into the Tauri WebView; it is not a standalone browser product. Receives
  native MediaPipe landmarks over Tauri IPC, scores them, and renders the live
  session. It does not own the live-session camera.
- **Native core** (`companion/src-tauri/`) — Tauri 2 + Rust. Hosts the UI,
  captures and infers faces through AVFoundation + MediaPipe, watches which
  app/site is frontmost, and **blocks** distracting apps and sites during a
  session. Rust and React communicate only through Tauri commands and events;
  there is no local HTTP service.

The differentiator is that last word. Every competitor measures. This one
intervenes. Keep that asymmetry in mind when weighing features.

**Who it is for:** Clemens, 18, Austria. Launching around September 2026,
starting civil service the same month, so he has roughly 10–15 h/week from then.
Optimise for things that survive low maintenance.

**Positioning claim that constrains engineering:** *nothing leaves your device.*
The camera feed, the activity log, window titles and file names never go
anywhere. There is exactly one deliberate exception, described in §5.

**Supported platform:** Apple Silicon Macs (`aarch64-apple-darwin`, M1 or
newer), macOS 11+. Intel Macs are intentionally unsupported as of 1 Sep 2026.
Do not restore Universal/x86_64 artifacts: their camera slice could start the
app but could never run the native measurement engine.

---

## 2. Run it

```bash
npm install
npm run dev        # isolated UI development only; native features unavailable
npm test           # vitest, currently 442 tests — must stay green
npm run build      # production bundle
```

Rust side:

```bash
cd companion/src-tauri
cargo test         # currently 72 tests (13 library + 59 app)
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
   enough. Coverage is diagnostic, not an all-or-nothing gate: after five real
   measured minutes, V1 scores only measured seconds and its volume term gives
   no credit for gaps. Legacy sessions without raw measurements stay absent
   rather than being guessed. Review V1 after 30 valid measured days and create
   V2 for changed parameters instead of rewriting stored V1 days.

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

There are currently 442 JS tests and 72 Rust tests (13 native-camera library
tests plus 59 app tests). Both suites must stay green. Treat these counts as a
checkpoint, not a substitute for reading the runner output when tests are added.

Test the **refusals and the boundaries**, not just the happy path. The valuable
tests here assert that the code stays quiet on thin data, rejects malformed model
output, and survives records written before a field existed.

**A green build is not verification.** The live-session camera is native, so
`npm run dev` and a browser `getUserMedia` stub cannot exercise it. Use the
internal native diagnostic for frame flow and the installed app with a real
camera for scoring, minimize and close/hide behavior. The camera-less build
machine can run the recorded-frame parity harness, not the live-camera test.

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

---

## 10. Camera measurement architecture — decided 29 Aug 2026

**Read this before touching anything camera-related. It ends a chain of four
failed fixes.**

### The finding

Background attention measurement cannot be built on `getUserMedia` inside the
WebView on macOS. Not "is buggy" — cannot.

- macOS **does** allow background camera capture. The green camera indicator
  stays lit while the window is minimized, and the iOS-style restrictions
  (`videoDeviceNotAvailableInBackground`, the `multitasking-camera-access`
  entitlement) are iOS-only concepts. Zoom, OBS and Photo Booth capture while
  backgrounded.
- **WKWebView** is what stops delivering frames once its view is not in a
  visible window. Apple's own forum guidance is explicit that native capture
  keeps working in the background while the WebView's does not, and the iOS
  workaround (`UIBackgroundModes`) has no macOS equivalent.
- Observable signature: the track stays `readyState === 'live'` and
  `video.readyState` stays 4, but WebKit stops decoding, so the element hands
  out **the same frozen frame forever**. MediaPipe returns identical landmarks
  every time, producing a flat, confident score for a user who has walked away.

### What was tried and did not fix it — do not retry

- `28be656` — native `CloseRequested` uses `minimize()` instead of `hide()`.
  Worth keeping (a hidden window is fully unmapped), but not the cause.
- `de67f03` — App Nap exemption via `NSProcessInfo` activity token, held while
  a session is active or paused. Worth keeping, not the cause.
- `7f645a5` — `"backgroundThrottling": "disabled"` (WebKit
  `inactiveSchedulingPolicy = none`). **Tested on macOS 15.7.3: no effect.** It
  governs task scheduling, not the capture pipeline.
- `ea2bdfc` — stale-frame guard: `video.currentTime` was watched, and a picture
  frozen for over a second was no longer fed to MediaPipe. It was load-bearing
  while the WebView source existed. Native V2 replaces it with a one-second
  AVFoundation frame heartbeat; that equivalent honesty guard is now
  load-bearing. Removing it silently reintroduces fabricated focus time.

### The decision

Camera capture and landmark inference move into the native Rust process
(AVFoundation + the **same** MediaPipe TFLite models). The WebView becomes
display only. Rationale for using the same models rather than Apple Vision:

- Vision gives 76 landmarks and one pupil point per eye; MediaPipe with
  `refineLandmarks: true` gives 468 landmarks plus five iris points per eye.
- Every scoring constant, the gaze geometry and the yaw/iris sign conventions
  (§4.7) are tuned to MediaPipe's geometry, several with research citations.
- Above all, §5's *"One ruler, every day"*: changing the landmark engine changes
  the ruler and makes all existing history incomparable.

Feeding native frames into the WebView so MediaPipe.js could stay was
considered and rejected: measurement would still depend on WebKit keeping JS
alive while hidden, which is the exact class of dependency that caused this.

### The parity result and replacement gate

The original main risk was preprocessing (ROI crop, rotation and scale before
landmark inference): a slight mismatch shifts every coordinate and silently
changes tuned thresholds. The parity work also proved that identical weights do
not guarantee identical output across WebGL and CPU execution backends.

Parity was measured on identical recorded frames, reporting mean/p95/max for
landmark delta, pose, per-frame score and `FOCUSED_SCORE` classification. Native
V2 reached 97.2806%, below the proposed 99% classification gate. It is not and
must never be presented as V1 parity.

The same isolation showed FaceMesh.js WebGL does not meet those score and
classification gates against FaceMesh.js CPU. Clemens explicitly delegated the
parity-gate decision to Codex on 1 Sep 2026; Codex retired the fixed WebGL 99%
gate as a promotion gate because the historical execution backend is not a
stable reference implementation. Keep the harness, failed numbers and
model/sign checks as characterization and regression evidence.

The replacement gate is: every new session is explicitly V2 with pinned model
hashes; no daily score, trend bucket or pattern mixes generations; missing
native frames remain absent measurement; and the real minimize/close score test
passes. This is a versioned ruler migration, not a claim of equality.

`SCOREABLE_SCORING_VERSIONS` includes V1 and V2 but refuses a missing version.
Per day, `calculateDailyFocus` uses the highest generation present.
`comparableSessions()` narrows cross-session comparisons to the most recently
used generation. V1 history remains stored and readable, but is excluded from
V2 comparisons. Existing users therefore need eight usable V2 sessions before
patterns speak again. Do not bypass that silence by blending generations.

### Native V2 status (1 Sep 2026)

Native V2 is the **only** live-session source in every native build. The old
WebView `getUserMedia`/FaceMesh.js session path and its preference toggle are
removed:

- `AVCaptureSession` delivers 640×480 BGRA buffers to a bounded native queue.
  Rust immediately copies them to in-memory RGB; no live frame is written to
  disk or sent over IPC.
- The models are byte slices from the exact `@mediapipe/face_mesh`
  `0.4.1633559619` packed asset already used by the WebView: short-range face
  detector plus `face_landmark_with_attention.tflite` (478 points). Do not
  replace them with a modern Face Landmarker `.task`: its 256×256 unified-output
  graph is not the same model contract.
- The attention graph needs MediaPipe's three custom TFLite ops
  (`Landmarks2TransformMatrix`, `TransformTensorBilinear`,
  `TransformLandmarks`). The native loader registers the official V2 ops from
  the pinned MediaPipe 0.10.35 arm64 library. That library is verified and
  bundled at build time; the installed app never downloads it at runtime.
- Detector letterboxing, weighted NMS, detection/landmark ROI tracking,
  192×192 rotated crop, attention-region refinement and full-image projection
  are native. There is no horizontal mirror in preprocessing. The resulting
  signs are held by tests: `yawSigned > 0` is head-left and `irisH > 0` is
  eyes-right.
- Only landmarks/status cross Tauri events. If AVFoundation delivers no new
  buffer for one second, the native ROI is reset and status becomes
  `faulted/no_frames`; no previous landmarks are replayed.

The underlying compatibility commands remain `start_native_camera_prototype`,
`stop_native_camera_prototype`, and `get_native_camera_status`; events are
`native-camera-landmarks` and `native-camera-status`. Internal-test/dev builds
show a start/stop/frame-counter diagnostic on Protection, but it cannot change
the session source. Leaving that screen stops the diagnostic before a session
claims the camera. Native landmarks feed the unchanged JavaScript scorer
through Tauri events; live pixels never cross IPC.

On 29 Aug 2026 Clemens verified this prototype on the target MacBook Air: the
native frame sequence continued advancing both while the window was yellow-
minimized and while it was red-closed/hidden, until he pressed Stop. This passes
the Step 1 native-lifecycle test. At that point it did **not** verify the V2 live
session score; the later result is recorded below.

On 31 Aug 2026 Clemens then verified the opt-in V2 live session on that MacBook:
the score/timeline changed after deliberate movement and looking away during
both yellow minimize and red close/hide, no window action created a pause or
manual-resume requirement, and the saved debrief identified the native V2
ruler. This passes the live minimize/close gate. It does not cover hard camera
loss, system sleep/lid close, or CPU/energy impact; keep those claims open.

V2 renders its live preview with a native `AVCaptureVideoPreviewLayer` sharing
the existing `AVCaptureSession`. React sends only the placeholder's geometry
through the `set_native_camera_preview` command; preview pixels are never
serialized or emitted into the WebView. Preview-layer failure is presentation
only and must not fault otherwise valid landmark measurement. Do not replace
this with frame bytes, data URLs, canvas copies, or a second capture session.

The harness must remain a Cargo `example`, not a `src/bin` target: Tauri tries
to bundle extra binaries and can select the wrong app executable.
`Cargo.toml` also keeps `default-run = "eudonomia-companion"` so no future
auxiliary target can silently become the app executable.

The recorded-frame tools are:

```bash
cargo run --manifest-path companion/src-tauri/Cargo.toml \
  --example native_camera_reference -- <frames-dir> <native.jsonl>
# Optional ROI isolation only:
# append --roi-oracle <facemesh-js-cpu.jsonl>
# Run npm dev, open /native-camera-parity.html, select the same directory and
# GPU/WebGL. CPU is an explicit backend diagnostic, not the historical ruler.
npm run camera:parity:compare -- <facemesh-js.jsonl> <native.jsonl>
```

The comparator replays both landmark streams through the same camera-only JS
scorer. Clemens' 4:51 / 4,376-frame run on 30 Aug 2026 **failed** the fixed
gate: landmark mean/p95/max `0.001283/0.004537/0.088413`, yaw p95 `2.311°`,
pitch p95 `0.627°`, score p95 `6.799`, and focused-classification parity
`97.2806%` (119 mismatches). Replicated landmark-crop borders match the legacy
graph and improved the result, but lossless PNG, isolated re-detection, Metal,
WebGL-mediump emulation and PNG colour-profile normalization did not close the
remaining gap. Further full-clip isolation proved that the exact v0.8.8 CPU
runtime is effectively identical to the pinned v0.10.35 native runtime, that
driving native tracking from the preceding JS landmarks barely changes the
failure, and that FaceMesh.js WebGL versus FaceMesh.js CPU itself misses the
score/classification gates (`4.000` p95, `98.8574%`). Identical weights do not
make execution backends interchangeable. Full numbers and eliminated
hypotheses are in
`docs/native-camera-prototype.md`. The failed parity is why V2 must stay
versioned. The live minimize/close gate has since passed as recorded above;
CPU/battery and hard camera-removal tests remain outstanding. Do not claim
those separate boundaries have passed.

That real-use confirmation completed migration Step 5. On 1 Sep 2026 the
WebView live-session camera path and source toggle were removed. Visible
onboarding/workspace calibration and the explicit recorded-frame parity harness
may still use WebView camera/FaceMesh code; they are not session measurement.

### Verifying it — the traps that already cost real time

- **A green build proves nothing here.** The decisive test is: start a session,
  fixate, note the score, minimize, deliberately look away and move around for
  ~2 min, reopen. **The score must have changed.** A flat line means unfixed.
  This was reported as fixed three times before that test was actually run.
- **Two machines.** Builds happen on a Mac Mini, which has **no camera**. The
  test above is impossible there. The parity harness runs on recorded frames and
  needs no camera; the real camera test and the reference-frame recording belong
  to Clemens on his MacBook Air. Never report the camera test as passed from a
  machine that cannot perform it.
- **Do not drive the app with AppleScript/System Events.** The test build and
  the installed app share the process name `eudonomia-companion`, and System
  Events routes clicks by OS focus rather than by the PID addressed — even with
  a distinct bundle identifier. This started two real sessions in Clemens'
  production app during the investigation. Test manually.
- **Check the release channel before claiming something is live.** Confirm the
  assets under the `internal-test` tag are actually new and that Clemens sees
  the matching build id. Testing against the wrong build has happened more than
  once (§2).
