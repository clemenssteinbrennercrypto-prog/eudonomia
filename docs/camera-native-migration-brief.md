# Migration brief: move camera measurement out of the WebView

Read `AGENTS.md` and `CLAUDE.md` completely before working on this migration.
Pull and rebase from `origin/main` before starting and before pushing.

This brief records a completed root-cause analysis. Do not restart that
investigation or repeat the rejected lifecycle workarounds below.

## 1. Failure

A live session must continue measuring attention while its window is minimized
or closed/hidden. The WebView camera path did not do that.

User-verified reproduction:

1. Start a session and look steadily at one point until the score settles.
2. Yellow-minimize the window.
3. Look into dead zones, move around and look away.
4. Reopen the window.
5. The score and green timeline remain flat at their pre-minimize value.

The macOS camera indicator remains green. The media track also stays `live` and
the video element stays ready, but `video.currentTime` and the decoded pixels
stop changing. MediaPipe repeatedly receives the frozen image and returns the
same confident landmarks.

## 2. Established root cause

WKWebView stops delivering new `getUserMedia` video pixels when its view is no
longer in a visible window. Scheduling JavaScript more aggressively does not
restart that media pipeline.

The native-camera architecture no longer relies on an audio-specific forum
quote as evidence for video behavior. The direct evidence is stronger:

- The stale-frame guard reproduced the frozen WebView mechanism on the target
  MacBook.
- On 29 August 2026, the native AVFoundation prototype's frame sequence and
  FaceMesh inference continued advancing on that MacBook during both yellow
  minimize and red close/hide, until the user pressed Stop.
- The documented `videoDeviceNotAvailableInBackground` interruption and
  multitasking-camera entitlement are iOS concepts; they do not provide a
  macOS WebView workaround.

The Apple forum thread remains useful context for native capture and WebView
lifecycle behavior, but its quoted example concerns `AVAudioSession`. It must
not be presented as direct proof of camera behavior.

Sources:

- https://developer.apple.com/forums/thread/689182
- https://developer.apple.com/documentation/AVFoundation/AVCaptureSession/InterruptionReason/videoDeviceNotAvailableInBackground

Consequence: reliable macOS background measurement cannot keep
`getUserMedia` inside the WebView as its frame source. No React visibility,
focus or timer handler changes that boundary.

## 3. Attempts that must remain but did not solve the cause

| Commit | Change | Result |
|---|---|---|
| `28be656` | Close requests minimize instead of fully unmapping the window | Useful, but WebKit still freezes video delivery |
| `de67f03` | Hold an App Nap exemption while a session is active or paused | Useful, but App Nap was not the media-pipeline boundary |
| `7f645a5` | Disable WebKit background throttling on supported macOS versions | Ineffective for capture; it changes scheduling policy |
| `ea2bdfc` | Reject a video image whose `currentTime` is stale for more than one second | Required honesty guard, not a background-capture fix |

The `ea2bdfc` guard prevents a frozen image from becoming invented measured
time. Preserve it until the old path is removed, and preserve an equivalent
native frame heartbeat afterward.

## 4. Required architecture

- Capture frames with AVFoundation in the native Rust process.
- Run the same MediaPipe detector and Attention FaceMesh weights natively.
- Send landmarks or derived signals to React only through Tauri commands and
  events.
- Keep live pixels inside the native process and in memory.
- Keep V1 and V2 as explicit scoring generations if backend parity is not
  reproducible; never relabel native output as V1.

Do not replace FaceMesh with Apple Vision. Vision's landmark and iris geometry
does not match the ruler on which the existing EAR, gaze, pose and history
thresholds were calibrated.

Do not capture natively and then run MediaPipe.js in the hidden WebView. That
would retain the WebKit lifecycle dependency this migration exists to remove.

## 5. Exact model contract

The JavaScript application uses the legacy `@mediapipe/face_mesh` solution with
`refineLandmarks: true`. Its TFLite files are slices inside
`face_mesh_solution_packed_assets.data`, not loose repository files. The native
implementation must use the matching short-range detector and 478-point
Attention landmark model.

The implemented prototype pins and documents:

- `@mediapipe/face_mesh` `0.4.1633559619`
- the exact packed-asset, detector and Attention-model SHA-256 values
- Google's official MediaPipe 0.10.35 arm64 runtime and its SHA-256
- the three required V2 custom TFLite operators

See `docs/native-camera-prototype.md` for offsets, hashes and runtime details.

## 6. Parity evidence and the replacement release gate

The main risk is preprocessing, not merely loading identical weights. FaceMesh
crops, scales and rotates a tracked facial ROI before landmark inference. A
small transform mismatch changes the meaning of tuned thresholds without an
obvious failure.

Both engines processed the same recorded pixels, with mean, p95 and maximum
reported for:

- normalized landmark distance
- `yawSigned` and `pitchDeg`
- EAR for each eye
- `irisH`
- per-frame attention score
- `FOCUSED_SCORE` classification

The original proposed gates were:

- landmark p95 `< 0.005`, maximum `< 0.02`
- yaw and pitch p95 `< 1.5°`
- score p95 `< 2` points
- identical `FOCUSED_SCORE` classification for at least 99% of frames

The recorded native run did not pass those gates, and it is not being presented
as V1 parity. The same investigation also showed that FaceMesh.js WebGL misses
the score and classification gates against FaceMesh.js CPU. The historical
WebGL execution is therefore not a stable reference implementation that a
native CPU backend can be required to reproduce at 99%.

**Decision, 1 September 2026:** retire the fixed 99% WebGL comparison as a
promotion gate. Keep the harness and all recorded numbers as characterization
evidence and as a regression corpus; do not delete, weaken or rewrite the failed
result. Its purpose is now to detect unexplained native preprocessing, model or
sign drift, not to certify V2 as V1.

The replacement release gate is explicit generation integrity plus observable
measurement behavior:

- every new live session records native V2's source, generation and model hashes
- no daily score, trend bucket or pattern mixes V1 with V2
- landmark/model tests preserve the empirical yaw and iris sign conventions
- a missing/stale native frame is absent measurement, never a replayed score
- the real MacBook minimize and close/hide score tests pass

This is a ruler migration, not a claim that the rulers are equal. Existing V1
history remains readable, while V2 comparisons start anew and require their own
sample minimums.

Do not reinterpret signs. Match them empirically through the harness:
`yawSigned > 0` is head-left from the user's perspective, while `irisH > 0` is
eyes-right.

## 7. Measurement and privacy invariants

- Scoring constants and thresholds do not change in this migration.
- Every penalty retains its hold time or debounce.
- Reset accumulators on face absence, camera fault and other hard transitions.
- No real frames means absent measurement: `trackingFaulted` and
  `finalScore: null`, never a plausible default score.
- Window focus, blur, visibility, minimize and close never change pause state.
- Live frames never leave the native process and are never written to disk.
- The only disk exception is the user's explicit local parity recording. It
  stays outside the repository and must be deletable after the comparison.
- Rust and React communicate only through Tauri IPC. Do not add HTTP or
  WebSocket transport.

## 8. Staged delivery

1. Native AVFoundation capture and landmark prototype over Tauri IPC.
2. Recorded-frame parity harness and measured characterization.
3. Temporarily expose the native source behind an internal flag.
4. Feed native landmarks into the existing JavaScript scorer.
5. After real-use confirmation, make V2 the only live source and remove the
   WebView session-camera path.

Step 1 is implemented and its minimize/close lifecycle was verified on the
target MacBook. Step 2 has now run on Clemens' 4:51 reference clip, including a
shared stateful JavaScript score replay, and **failed** the fixed gate:
landmark p95/max `0.004537 / 0.088413`, yaw p95 `2.311°`, pitch p95 `0.627°`,
score p95 `6.799`, and focused classification parity `97.2806%` (119 of 4,376
frames differed). At that gate, no live-session source switch occurred. See
`docs/native-camera-prototype.md` for the complete table and eliminated
preprocessing hypotheses. Subsequent full-clip isolation also ruled out the
modern TFLite runtime and recursive ROI drift as the main cause; neither the
exact v0.8.8 CPU runtime nor the native Metal delegate reproduces the historical
WebGL ruler. FaceMesh.js WebGL versus its own CPU inference already misses the
score/classification gates. This strengthens, rather than removes, the need for
an explicit product decision if exact WebGL-path parity cannot be reproduced.

Clemens made that decision on 30 August: ship the native path as a separately
versioned V2 ruler, never as a passing V1 parity result. Steps 3 and 4 provided
the temporary internal rollout. On 31 August he completed the real MacBook live
test: after establishing a score, he deliberately moved and looked away while
yellow-minimized and again while red-closed/hidden; on reopening, the score and
timeline had changed. Neither window action paused the session or required a
manual resume, and the saved debrief identified V2. That is the real-use
confirmation required by Step 5.

**Step 5 completed 1 September 2026.** Native V2 is intentionally the only
live-session measurement source in every native build. The preference and
source toggle are gone, and `SessionScreen` no longer acquires WebView
`getUserMedia` or constructs FaceMesh.js. The internal Protection panel remains
as capture diagnostics only. Visible onboarding/workspace calibration and the
explicit recorded-frame harness may still use WebView camera/FaceMesh code;
they are not hidden-window session measurement paths.

This default change deliberately starts existing users' comparisons at V2.
Their V1 records remain stored and readable, but patterns stay silent until V2
has the required eight usable sessions. That reset is the cost of preserving
generation integrity, not an accidental side effect.

**Revised 31 August.** V2 sessions were not merely kept out of V1 history — they
produced nothing at all: no daily score, no ledger entry, no trend, no patterns.
Anyone using the native camera measured themselves and had every measurement
discarded, with only an orange "not counted" notice to explain it.

Clemens' decision: V2 becomes the primary ruler, because it is the source that
keeps measuring when WebKit suspends the camera, which is the failure this
migration exists to solve. Chasing the remaining 1.72% is not the path — the
same investigation found FaceMesh.js WebGL does not reproduce its own CPU
inference, so the 99% gate compares against a reference that is not stable.

What changed, and the invariant that replaces the old one:

- `SCOREABLE_SCORING_VERSIONS` in focusMetric.js lists the generations the
  metric will score. V1 and V2 both qualify; a session with no version is still
  refused, since missing means pre-versioning and its raw fields need the
  explicit recovery path.
- **No single day, trend bucket, or pattern ever mixes two generations.**
  `calculateDailyFocus` scores a day using the newest generation present and
  sets the others aside; `comparableSessions` narrows any cross-session
  comparison to the newest generation in the data. A camera switch therefore
  restarts trends and patterns rather than blending two scales.
- V1 history remains stored, readable and listed. It is excluded from
  comparison against V2, not deleted.

The tests that encoded the previous decision were replaced rather than removed,
each carrying the date and reasoning — see focusMetric.test.js,
historyTrend.test.js, calibration.test.js and sessionAnalysis.test.js.

The fixed 99% WebGL gate is retired for the reasons in §6. Hard camera loss,
system sleep/lid close and quantified CPU/energy comparison remain separate
open verification boundaries.

## 9. Two-machine boundary

The Mac Mini build machine has no built-in camera. It can compile, run tests and
process recorded frames, but it cannot perform the real camera test.

Only the user's MacBook Air can:

- record the reference clip
- verify native frames through minimize and close
- verify the eventual live session score while deliberately looking away
- test real camera removal or contention

Never claim one of those tests passed on the camera-less build machine.

CI, not a local build, publishes the artifact the user runs. A push to `main`
updates the `internal-test` release through `companion-test.yml`. Confirm both
the tag and the displayed build ID before asking the user to test.

## 10. Verification

Automated baseline is updated whenever the suites change:

```bash
npm test -- --run                 # 434 tests
npm run build
cd companion/src-tauri
cargo test                        # 70 tests: 13 library + 57 app
cargo check
```

A green build is not runtime verification. Manually test native V2 with a real
camera:

1. Start a session, fixate and note the score.
2. Yellow-minimize, deliberately look away and move for about two minutes.
3. Reopen; the score and timeline must have changed.
4. Repeat with red close/hide.
5. Inspect `actualSeconds`, `measuredSeconds`, `measurementCoverage`,
   `trackingFaulted` and `completed` in the saved record.
6. Remove or occupy the camera; unavailable time must remain unmeasured.

Do not automate these clicks through AppleScript/System Events: test and
production builds share a process name, and previous automation started real
sessions in the wrong app. Do not kill the running companion without first
confirming there is no active session and blocking is disabled.

## 11. Required final report

- exact weights and provenance
- full parity table, including focused-classification parity
- preprocessing, mirroring and sign conventions
- old-versus-native CPU and energy measurements
- real yellow-minimize and red-close live-score results
- hard camera-failure honesty result
- remaining system-sleep, lid-close and camera-contention limitations
- commit hashes and verified `internal-test` status

Commit messages must explain the prevented failure and record facts a later
agent would otherwise have to rediscover. Include the agent's attribution
trailer. Do not modify `.github/workflows/` as part of this work.
