# Native camera prototype and parity gate

Status: opt-in native scoring V2 for internal builds, 30 August 2026. Exact
parity with the historical WebGL ruler failed, so V2 is deliberately separate.
Nothing in this document is evidence that the background-camera bug is fixed
until the real MacBook live-session tests pass.

## Exact model and runtime provenance

The native path does not use Apple Vision and does not use the current 256×256
MediaPipe Face Landmarker task. It slices the same packed asset used by the
existing JavaScript FaceMesh solution:

- npm package: `@mediapipe/face_mesh` `0.4.1633559619`
- packed asset SHA-256:
  `dbe5905c582c0462cdaea17e7e6ecea92edaa8cccc515c5e2e7291f2cbb5fb99`
- `face_landmark_with_attention.tflite`: bytes `0..2495952`, SHA-256
  `883b7411747bac657c30c462d305d312e9dec6adbf8b85e2f5d8d722fca9455d`
- `face_detection_short_range.tflite`: bytes `3757224..3986256`, SHA-256
  `3bc182eb9f33925d9e58b5c8d59308a760f4adea8f282370e428c51212c26633`

The offset source is the package's own
`face_mesh_solution_packed_assets_loader.js`, not a guessed scan of the data
file.

Inference uses the TensorFlow Lite C API exported by Google's official
MediaPipe 0.10.35 macOS arm64 wheel. Its wheel SHA-256 is pinned upstream as
`3b31376f34ca3665e34b834565996464cd66c9c91316e914fa7f149c891ce7ac`;
the extracted dylib is additionally pinned here as
`f183acadefa74df7d9651beb3ff8339320c544020920e8d9038637f50bfdd453`.
The build downloads and verifies the wheel, then bundles only
`libmediapipe.dylib`. Runtime downloading is disabled.

The legacy Attention model cannot run in a generic TFLite interpreter without
three MediaPipe custom operators. The loader resolves and registers the
official V2 implementations for:

- `Landmarks2TransformMatrix`
- `TransformTensorBilinear`
- `TransformLandmarks`

An attempted modern `.task` wrapper was rejected. Besides requiring new model
metadata, the current task graph expects a 256×256 input and one unified
478×3 output. The existing legacy model is 192×192 and emits base mesh, lips,
two eye regions, two irises and face presence as seven tensors. Treating those
as interchangeable would silently change the ruler.

## Native preprocessing

The implementation follows the MediaPipe v0.8.8 graphs from 6 October 2021,
matching the timestamp embedded in the npm package version:

1. Convert the unmirrored AVFoundation BGRA frame to in-memory RGB.
2. Letterbox the complete frame to 128×128 with zero border and range `[-1, 1]`.
3. Decode 896 BlazeFace anchors, apply the 0.5 confidence threshold and weighted
   NMS at IoU 0.3.
4. Build a square-long face ROI from the two eye keypoints, scale it by 1.5 and
   rotate it so the eyes are horizontal.
5. Bilinearly sample that ROI to 192×192 in range `[0, 1]`, replicating edge
   pixels when the ROI leaves the image. `BORDER_REPLICATE` is the legacy
   landmark graph's default; only the detector explicitly uses zero border.
6. Decode the 468-point mesh and replace lips/eyes with the Attention tensors;
   append five points per iris and inherit iris depth from the matching eye.
7. Project x/y/z back into normalized full-frame coordinates. A successful
   landmark frame supplies the next frame's ROI, as the JavaScript video graph
   does; loss of face or frames resets it.

No horizontal mirror is applied. CSS mirrors some previews, but FaceMesh.js
receives the original video pixels. Tests preserve the existing opposite sign
conventions: positive `yawSigned` means head-left; positive `irisH` means
eyes-right.

## Live prototype IPC and honesty boundary

The commands `start_native_camera_prototype` and
`stop_native_camera_prototype` own a native worker independent of WebView
visibility. `native-camera-landmarks` contains a sequence number, capture time,
face-presence flag and optional 478 landmarks—never pixels. A one-element frame
queue drops work when inference falls behind instead of growing memory.

Internal-test builds expose these commands as a diagnostic card on the
Protection / Focus Apps screen. Start it outside a session, note the native
frame sequence, minimize or close the window, then reopen; the sequence must
have advanced. Leaving the screen stops the diagnostic so it cannot remain a
second camera owner when an opt-in V2 session begins. The separate toggle on
that card controls whether new sessions use V2; the buttons themselves do not.

On 29 August 2026 Clemens ran that diagnostic on the target MacBook Air. The
frame sequence continued advancing until Stop during both yellow minimize and
red close/hide. This is the required Step 1 proof that native capture and
inference survive those window states. It was not a live-score verification;
the later V2 session wiring still requires its own test.

AVFoundation callbacks are the native frame heartbeat. After one second
without a real callback the prototype emits `faulted/no_frames`, clears the ROI
and sends no repeated landmark packet. This is the native equivalent of the
load-bearing `video.currentTime` guard. It has compile/unit coverage but has not
yet been exercised by hard camera removal on the camera-less Mac Mini.

The recorded-frame runner is a Cargo `example`, not a `src/bin` target. Tauri
tries to bundle additional Cargo binaries and can select the wrong app
executable unless `default-run` is explicit. Keep both the example location and
`default-run = "eudonomia-companion"`.

The pinned inference dylib is arm64-only. A former Universal build paired it
with an x86_64 application slice that contained only an unsupported-camera
stub. That slice could launch but could not perform the product's core
measurement. Clemens ended Intel support on 1 Sep 2026: builds, updater
manifests and release artifacts are Apple Silicon only, and non-arm64 Rust
targets fail instead of producing a misleading partial app.

## Recorded-frame harness

Native run:

```bash
cargo run --manifest-path companion/src-tauri/Cargo.toml \
  --example native_camera_reference -- /path/to/frames /path/to/native.jsonl
```

ROI-isolation diagnostic (not a parity result by itself):

```bash
cargo run --manifest-path companion/src-tauri/Cargo.toml \
  --example native_camera_reference -- /path/to/frames /path/to/native-oracle.jsonl \
  --roi-oracle /path/to/facemesh-js-cpu-reference.jsonl
```

JavaScript reference:

```bash
npm run dev
# Open the printed origin plus /native-camera-parity.html.
# Select the same directory and the GPU/WebGL backend, then download the JSONL.
# GPU/WebGL is the historical ruler; the CPU option is diagnostic only.
```

Comparison:

```bash
npm run camera:parity:compare -- \
  /path/to/facemesh-js-reference.jsonl /path/to/native.jsonl
```

The report includes mean/p95/max for 3D normalized landmark distance and each
derived signal. Fixed gates are landmark p95 `< 0.005`, landmark max `< 0.02`,
yaw/pitch p95 `< 1.5°`, score p95 `< 2`, and 99% `FOCUSED_SCORE`
classification parity.

Both recorded-frame runners deliberately write `attentionScore: null`. The
comparator feeds both landmark streams through the same camera-only JavaScript
replay: 20-second personal calibration, rolling EAR/PERCLOS/head histories,
all existing holds and deadzones, trust gating, smoothing and the sustained
focus ramp. Activity scoring is disabled equally for both streams because it
is not an input to camera parity. Stateful constants are imported from the
same module as `SessionScreen`; `FOCUSED_SCORE` comes directly from
`attention.js`. Unit tests pin calibration, determinism and the distinction
between an explicitly unmeasured frame and a measured no-face result.

### Clemens' recorded parity result (30 August 2026)

Clemens recorded 4:51 of representative movement, blinks, deliberate gaze,
partial face loss and lighting variation on the target MacBook Air. The clip
was converted locally to 4,376 lossless 640×480 PNG frames at 15 fps. Both
engines processed those files in name order; no frame or result entered the
repository.

| Metric | Samples | Mean absolute delta | p95 | Maximum | Gate |
|---|---:|---:|---:|---:|---|
| 3D normalized landmark distance | 1,978,920 | 0.001283 | 0.004537 | 0.088413 | **Fail:** max must be `< 0.02` |
| `yawSigned` (degrees) | 4,140 | 0.595 | 2.311 | 32.959 | **Fail:** p95 must be `< 1.5°` |
| `pitchDeg` (degrees) | 4,140 | 0.125 | 0.627 | 7.958 | Pass |
| right EAR | 4,140 | 0.011982 | 0.034130 | 0.459698 | Diagnostic |
| left EAR | 4,140 | 0.015339 | 0.036166 | 2.023709 | Diagnostic |
| average EAR | 4,140 | 0.010360 | 0.028123 | 0.992915 | Diagnostic |
| `irisH` | 4,140 | 0.012227 | 0.026947 | 1.346746 | Diagnostic |
| attention score | 4,376 | 1.413 | 6.799 | 23.070 | **Fail:** p95 must be `< 2` |

Face-presence parity was 99.8629%: six frames disagreed, concentrated where
the face was deliberately moved partly out of frame. Focused classification
parity was **97.2806%** (119 of 4,376 frames disagreed), below the required
99%. This is the decisive failure because it would change `focusedSeconds`.

The landmark p95 passes narrowly, while edge/out-of-frame maxima, saturated
large-yaw estimates and stateful score consequences do not. Changing the
landmark crop from zero padding to the graph's required replicated border
improved mean, p95 and maximum from approximately
`0.00155 / 0.00483 / 0.18596` to the values above, but did not pass the gate.

The following hypotheses were checked without weakening any threshold:

- Lossy JPEG input was replaced by lossless PNG; the result remained outside
  the gate.
- Tracked sequences and isolated re-detection frames both showed deltas, so
  the result is not only accumulated ROI drift.
- The native Metal delegate and a WebGL-mediump emulation did not improve the
  result and were reverted.
- The PNGs' BT.709 profile was changed to sRGB without changing decoded RGB
  checksums. Safari produced the exact same parity statistics, excluding image
  colour-profile conversion as the explanation.
- The legacy v0.8.8 detector/landmark graphs, ROI transforms, refinement maps,
  projection, thresholds and lack of graph smoothing were checked against the
  official source.

#### Backend, runtime and ROI isolation

Further full-clip runs used the same 4,376 PNGs and the same shared score
replay. These diagnostic comparisons did not pass or authorize a V1 source
switch; the later V2 decision is recorded below.

| Comparison | Landmark mean / p95 / max | Yaw p95 | Score p95 | Focused parity |
|---|---:|---:|---:|---:|
| FaceMesh.js WebGL vs FaceMesh.js CPU inference | 0.000298 / 0.000618 / 0.048729 | 0.259° | 4.000 | 98.8574% |
| FaceMesh.js CPU vs native CPU | 0.001238 / 0.004512 / 0.087683 | 2.344° | 7.785 | 97.5548% |
| FaceMesh.js CPU vs native CPU with the preceding JS landmarks driving the native ROI | 0.001181 / 0.004430 / 0.040202 | 2.281° | 7.776 | 96.5951% |
| Native MediaPipe 0.10.35 CPU vs exact v0.8.8 TFLite CPU runtime | 0.000013 / 0.0000003 / 0.010332 | 0.0001° | 0.000 | 100.0000% |
| FaceMesh.js WebGL vs native Metal delegate | 0.001344 / 0.004561 / 0.088269 | 2.402° | 7.912 | 97.3492% |

The exact historical v0.8.8 CPU runtime was built locally from MediaPipe tag
`v0.8.8` (`33d683c67100ef3db37d9752fcf65d30bea440c4`). Its output is effectively
identical to the pinned 0.10.35 native runtime, while being substantially
slower. A runtime downgrade therefore adds cost without closing parity and was
not added to the repository.

The ROI-oracle run replaces every native tracking ROI with one derived from the
preceding FaceMesh.js landmarks. Its small landmark improvement and unchanged
yaw/score failure show that recursive ROI drift is not the main discrepancy.
The harness exposes this only as `--roi-oracle`; it validates frame count,
index and filename before processing and is never called by live capture.

FaceMesh.js WebGL versus its own CPU inference also fails the score and focused
classification gates despite sharing the browser graph and preprocessing.
Conversely, using the official Metal delegate does not reproduce WebGL output.
Identical weights therefore do **not** imply an identical historical ruler
across execution backends. The unresolved delta is now bounded to the
WebGL-specific pixel-to-tensor/inference path, especially during motion blur,
large pose and partial face loss; it is not attributed to one unmeasured
floating-point operation.

On 30 August Clemens chose the honest alternative allowed by the failed gate: a
separately versioned native scoring generation. The internal source toggle now
writes `attentionScoringVersion: 2` and
`attentionMeasurementSource: native_mediapipe_v2`; release builds cannot enable
it. Stable V1 daily history and calibration refuse these sessions instead of
blending the rulers. The measured failure remains part of V2's provenance; it
was not turned into a pass and no threshold was changed.

### Early smoke result (not the parity gate)

Both engines were driven with the same three public still images from the
`rs-face-detection-tflite` test data. All three produced a face in both engines.
Across 1,434 landmark points, normalized 3D error was mean `0.001255`, p95
`0.002782`, maximum `0.004885`; yaw error was mean `0.545°`, p95/max `0.848°`,
and pitch error mean `0.208°`, p95/max `0.280°`. The comparator still exited 2
because scores were absent.

These numbers are useful only as a preprocessing smoke test. Three unrelated
still images do not exercise sustained tracking, blinks, deliberate gaze
changes, lighting changes, score holds, or the focused classification boundary.
They must not be reported as Clemens' required multi-minute parity result.

Reference frames and JSONL outputs are local user data. They remain outside the
repository and can be deleted after review.

## Still outstanding

- Measure CPU/energy impact for old and native paths on the same MacBook.
- Remove/occupy the real camera and prove session coverage becomes absent.
- Decide whether V2 becomes the stable generation only after the remaining
  energy and camera-loss tests.

System sleep, lid close and camera contention remain unverified. No claim about
those cases is warranted yet.

### Live V2 result (31 August 2026)

Clemens verified the internal V2 session source on the target MacBook Air. With
deliberate looking away and movement while the window was yellow-minimized and
red-closed/hidden, the reopened score and timeline changed; neither window
action paused the session or required a manual resume. The debrief carried the
native V2 ruler label. This passes the live minimize/close gate that the earlier
frame-counter diagnostic did not cover.

The V2 tile is intentionally not a camera preview. Live pixels remain in the
native process. A future preview must use a native `AVCaptureVideoPreviewLayer`
on the existing capture session rather than sending encoded frames through
Tauri IPC.

Before energy comparison, native capture was capped at 15 fps at the
AVFoundation connection. The WebView V1 pump samples every 67 ms and the parity
clip is 15 fps; processing faster adds no scoring resolution while increasing
sensor, RGB-copy, TFLite and IPC work. Compare the optimized build on the same
MacBook under the same brightness, power and foreground conditions. Hard camera
loss, system sleep/lid close and CPU/energy measurements remain open.
