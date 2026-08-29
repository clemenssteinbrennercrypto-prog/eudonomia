# Native camera prototype and parity gate

Status: prototype only, 29 August 2026. The session still measures through the
WebView. Nothing in this document is evidence that the background-camera bug is
fixed in the installed app.

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

The implementation follows the MediaPipe v0.8.9 graphs matching the timestamp
of the npm package:

1. Convert the unmirrored AVFoundation BGRA frame to in-memory RGB.
2. Letterbox the complete frame to 128×128 with zero border and range `[-1, 1]`.
3. Decode 896 BlazeFace anchors, apply the 0.5 confidence threshold and weighted
   NMS at IoU 0.3.
4. Build a square-long face ROI from the two eye keypoints, scale it by 1.5 and
   rotate it so the eyes are horizontal.
5. Bilinearly sample that ROI to 192×192 in range `[0, 1]`.
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
Protection / Focus Apps screen. It is not present in public builds and is not
connected to session scoring. Start it outside a session, note the native frame
sequence, minimize or close the window, then reopen; the sequence must have
advanced. Leaving the screen stops the prototype so it cannot remain a second
camera owner when a normal session begins.

AVFoundation callbacks are the native frame heartbeat. After one second
without a real callback the prototype emits `faulted/no_frames`, clears the ROI
and sends no repeated landmark packet. This is the native equivalent of the
load-bearing `video.currentTime` guard. It has compile/unit coverage but has not
yet been exercised by hard camera removal on the camera-less Mac Mini.

The recorded-frame runner is a Cargo `example`, not a `src/bin` target. Tauri
tries to bundle additional Cargo binaries and its Universal build fails when an
arm64-only harness has no liposuction output; it can also select the wrong app
executable unless `default-run` is explicit. Keep both the example location and
`default-run = "eudonomia-companion"`. The Universal release `.app` build was
verified with `eudonomia-companion` as its bundle executable, arm64 and x86_64
application slices, and the pinned arm64 inference dylib hash. The native camera
path intentionally remains unavailable in the x86_64 slice.

## Recorded-frame harness

Native run:

```bash
cargo run --manifest-path companion/src-tauri/Cargo.toml \
  --example native_camera_reference -- /path/to/frames /path/to/native.jsonl
```

JavaScript reference:

```bash
npm run dev
# Open the printed origin plus /native-camera-parity.html.
# Select the same frame directory and download facemesh-js-reference.jsonl.
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

Both current runners deliberately write `attentionScore: null`: the exact
stateful session scorer has not yet been extracted into a shared replay unit.
The comparator therefore exits non-zero even if landmark deltas are zero. This
is intentional—landmark parity alone may not authorize a source switch.

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

Reference frames and JSONL outputs are local user data. They must stay outside
the repository and can be deleted after review.

## Still outstanding

- Record Clemens' multi-minute reference sequence on the MacBook Air.
- Extract/replay the exact stateful scorer for both landmark streams.
- Publish the actual parity table; align preprocessing if any fixed gate fails.
- Measure CPU/energy impact for old and native paths on the same MacBook.
- Run real yellow-minimize and red-close tests with deliberate looking away.
- Remove/occupy the real camera and prove session coverage becomes absent.
- Only after all gates pass: add a source flag and feed native landmarks into
  the existing JavaScript scorer.

System sleep, lid close and camera contention remain unverified. No claim about
those cases is warranted yet.
